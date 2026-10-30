const db = require('./db');
const countryCatalog = require('../data/countries.json');

const zones = [
	{ code: 'norte', name: 'Norte', subdivisions: ['Viana do Castelo', 'Braga', 'Porto', 'Vila Real', 'Bragança'] },
	{ code: 'centro', name: 'Centro', subdivisions: ['Aveiro', 'Coimbra', 'Viseu', 'Guarda', 'Castelo Branco', 'Leiria', 'Santarém'] },
	{ code: 'lisboa', name: 'Lisboa e arredores', subdivisions: ['Lisboa', 'Setúbal'] },
	{ code: 'alentejo', name: 'Alentejo', subdivisions: ['Beja', 'Évora', 'Portalegre'] },
	{ code: 'algarve', name: 'Algarve', subdivisions: ['Faro'] },
	{ code: 'acores', name: 'Açores', subdivisions: ['Açores'] },
	{ code: 'madeira', name: 'Madeira', subdivisions: ['Madeira'] }
];

function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function normalizeFilters(input = {}) {
	const country = String(input.country_code || 'all').trim().toUpperCase();
	if (!['ALL', 'UNKNOWN'].includes(country) && !/^[A-Z]{2}$/.test(country)) invalid('País inválido.');
	const zone = input.zone ? String(input.zone).trim().toLowerCase() : null;
	if (zone && (country !== 'PT' || !zones.some(item => item.code === zone))) invalid('Zona inválida para o país selecionado.');
	const cityId = input.city_id == null || input.city_id === '' ? null : Number(input.city_id);
	if (cityId !== null && (!Number.isSafeInteger(cityId) || cityId <= 0)) invalid('Cidade inválida.');
	return { country_code: country === 'ALL' ? null : country === 'UNKNOWN' ? 'unknown' : country, zone, city_id: cityId };
}

// The caller supplies a fixed SQL expression; user input is always parameterized.
function geographyFilter(input = {}, cityExpression = 'gig.city_id') {
	const value = normalizeFilters(input);
	const conditions = [`geo_city.id = ${cityExpression}`];
	const params = [];
	if (value.country_code === 'unknown') conditions.push('geo_city.country_code IS NULL');
	else if (value.country_code) { conditions.push('geo_city.country_code = ?'); params.push(value.country_code); }
	if (value.zone) { conditions.push('COALESCE(geo_city.zone_code, geo_subdivision.zone_code) = ?'); params.push(value.zone); }
	if (value.city_id) { conditions.push('geo_city.id = ?'); params.push(value.city_id); }
	const active = conditions.length > 1;
	const predicate = active ? `EXISTS (SELECT 1 FROM city geo_city LEFT JOIN country_subdivision geo_subdivision ON geo_subdivision.id = geo_city.subdivision_id WHERE ${conditions.join(' AND ')})` : '';
	return { predicate, clause: predicate ? ` AND ${predicate}` : '', params, value };
}

async function options(input = {}) {
	const geo = geographyFilter(input, 'city.id');
	const [countries, subdivisions, cities] = await Promise.all([
		db.query('SELECT code, name FROM country ORDER BY name'),
		db.query('SELECT id, country_code, name, kind, zone_code FROM country_subdivision ORDER BY name'),
		db.query(`SELECT city.id, city.name, city.state, city.country_code, city.subdivision_id, city.municipality,
			COALESCE(city.zone_code, subdivision.zone_code) AS zone, country.name AS country_name, subdivision.name AS subdivision_name
			FROM city LEFT JOIN country ON country.code = city.country_code
			LEFT JOIN country_subdivision subdivision ON subdivision.id = city.subdivision_id
			WHERE 1=1${geo.clause} ORDER BY city.name, country.name, subdivision.name`, geo.params)
	]);
	const availableCountries = [...new Map([...countryCatalog,...countries].map(country=>[country.code,country])).values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-PT'));
	return { countries:availableCountries, zones: zones.map(({ code, name }) => ({ code, name, country_code: 'PT' })), subdivisions, cities: cities.map(city => ({ ...city, display_name: [...new Set([city.name, city.municipality, city.subdivision_name || city.state, city.country_name || 'País por classificar'].filter(Boolean))].join(' · ') })) };
}

module.exports = { zones, normalizeFilters, geographyFilter, options };
