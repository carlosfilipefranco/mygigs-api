const db = require('./db');
const helper = require('../helper');
const config = require('../config');
const { geographyFilter, zones } = require('./geography');
const countryCatalog = require('../data/countries.json');

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function text(value) { return typeof value === 'string' ? value.trim() || null : null; }
function normalizeCityName(value, countryCode = null) {
	const name = String(value || '').trim();
	if (countryCode && String(countryCode).toUpperCase() !== 'PT') return name;
	return /^(lisbon|lisboa)$/i.test(name) ? 'Lisboa' : name;
}
function normalizeCityState(value, countryCode = null) {
	const state = text(value);
	if (countryCode && String(countryCode).toUpperCase() !== 'PT') return state;
	return /^(lisbon|lisboa)$/i.test(state || '') ? 'Lisboa' : state;
}

async function getMultiple(page, filters = {}) {
	const geo = geographyFilter(filters, 'city.id');
	const limit = page ? ` LIMIT ${helper.getOffset(page, config.listPerPage)},${config.listPerPage}` : '';
	const rows = await db.query(`SELECT city.id,city.name,city.state,city.country_code,city.subdivision_id,city.municipality,
		COALESCE(city.zone_code,s.zone_code) AS zone,country.name AS country_name,s.name AS subdivision_name
		FROM city LEFT JOIN country ON country.code=city.country_code LEFT JOIN country_subdivision s ON s.id=city.subdivision_id
		WHERE 1=1${geo.clause} ORDER BY city.name,country.name,s.name${limit}`, geo.params);
	return { data: rows.map(row => ({ ...row, display_name: [...new Set([row.name,row.municipality,row.subdivision_name || row.state,row.country_name || 'País por classificar'].filter(Boolean))].join(' · ') })), meta: { page } };
}

async function get(id) { return db.query('SELECT id,name,state,country_code,subdivision_id,municipality,zone_code,source,source_id,classification_status FROM city WHERE id=?', [id]); }

async function resolveMetadata(input, query = db.query, trustedSource = false) {
	const countryCode = text(input.country_code)?.toUpperCase() || null;
	if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) fail('Código de país inválido.');
	if (countryCode) {
		const countries = await query('SELECT code FROM country WHERE code=?', [countryCode]);
		if (!countries.length) {
			const catalogCountry = countryCatalog.find(country=>country.code===countryCode);
			if (!trustedSource && !catalogCountry) fail('País não encontrado.');
			const countryName = catalogCountry?.name || text(input.country_name) || new Intl.DisplayNames(['pt-PT'], { type: 'region' }).of(countryCode);
			await query('INSERT INTO country(code,name) VALUES (?,?) ON DUPLICATE KEY UPDATE code=VALUES(code)', [countryCode, countryName]);
		}
	}
	let state = normalizeCityState(input.state, countryCode);
	let subdivisionId = input.subdivision_id ? Number(input.subdivision_id) : null;
	if (input.subdivision_id && (!Number.isSafeInteger(subdivisionId) || subdivisionId <= 0)) fail('Divisão administrativa inválida.');
	if (subdivisionId) {
		if (!Number.isSafeInteger(subdivisionId) || subdivisionId <= 0 || !countryCode) fail('Divisão administrativa inválida.');
		const rows = await query('SELECT id,name FROM country_subdivision WHERE id=? AND country_code=?', [subdivisionId,countryCode]);
		if (!rows.length) fail('A divisão administrativa não pertence ao país selecionado.');
		state = rows[0].name;
	} else if (countryCode && state) {
		const aliases = { Lisbon: 'Lisboa', Azores: 'Açores', Oporto: 'Porto', Setubal: 'Setúbal', Evora: 'Évora', Braganca: 'Bragança' };
		const canonical = countryCode === 'PT' ? aliases[state] || state : state;
		const rows = await query('SELECT id FROM country_subdivision WHERE country_code=? AND name=?', [countryCode,canonical]);
		subdivisionId = rows[0]?.id || null;
	}
	const zoneCode = text(input.zone_code);
	if (zoneCode && (countryCode !== 'PT' || !zones.some(zone => zone.code === zoneCode))) fail('Zona inválida para o país selecionado.');
	return { countryCode,state,subdivisionId,zoneCode,municipality:text(input.municipality) };
}

async function findCity(input, query = db.query) {
	const name = normalizeCityName(input.name || input.city_name,input.country_code);
	if (input.source && input.source_id) {
		const sourced = await query('SELECT id,name,state,country_code,subdivision_id,source_id FROM city WHERE source=? AND source_id=? LIMIT 1', [input.source,String(input.source_id)]);
		if (sourced.length) {
			if (input.country_code && sourced[0].country_code && sourced[0].country_code !== String(input.country_code).toUpperCase()) fail('O país recebido não corresponde à localidade da fonte.');
			return sourced[0];
		}
	}
	const conditions = ['LOWER(name)=LOWER(?)','country_code <=> ?'];
	const params = [name,text(input.country_code)?.toUpperCase() || null];
	if (input.subdivision_id) { conditions.push('subdivision_id=?');params.push(input.subdivision_id); }
	else if (input.state) { conditions.push('(state IS NULL OR LOWER(state)=LOWER(?))');params.push(normalizeCityState(input.state,input.country_code)); }
	if (input.municipality) { conditions.push('municipality=?');params.push(input.municipality); }
	if (input.source_id) { conditions.push('(source_id IS NULL OR (source=? AND source_id=?))');params.push(input.source,String(input.source_id)); }
	const rows = await query(`SELECT id,name,state,country_code,subdivision_id,source_id FROM city WHERE ${conditions.join(' AND ')} LIMIT 2`,params);
	return rows.length === 1 ? rows[0] : null;
}

async function ensureCity(input, query = db.query, trustedSource = false) {
	const metadata = await resolveMetadata(input,query,trustedSource);
	const name = normalizeCityName(input.name || input.city_name,metadata.countryCode);
	if (!name || name.length > 255) fail('Indica um nome de cidade válido.');
	const source = trustedSource ? text(input.source) : null;
	const sourceId = trustedSource && input.source_id != null ? String(input.source_id) : null;
	if ((source && source.length > 32) || (sourceId && sourceId.length > 128) || (metadata.municipality && metadata.municipality.length > 150)) fail('Os dados da localidade são demasiado longos.');
	const existing = await findCity({ ...input,name,country_code:metadata.countryCode,subdivision_id:metadata.subdivisionId,source,source_id:sourceId },query);
	const origin = trustedSource ? source || 'import' : 'manual';
	if (existing) {
		await query(`UPDATE city SET country_code=COALESCE(country_code,?),state=COALESCE(state,?),subdivision_id=COALESCE(subdivision_id,?),source=COALESCE(source,?),source_id=COALESCE(source_id,?),
			geography_source=COALESCE(geography_source,?),classification_status=IF(country_code IS NULL OR subdivision_id IS NULL,'pending','confirmed') WHERE id=?`,[metadata.countryCode,metadata.state,metadata.subdivisionId,source,sourceId,origin,existing.id]);
		return { id:existing.id,created:false };
	}
	try {
		const result = await query(`INSERT INTO city(name,state,country_code,subdivision_id,municipality,zone_code,source,source_id,geography_source,classification_status)
			VALUES (?,?,?,?,?,?,?,?,?,?)`,[name,metadata.state,metadata.countryCode,metadata.subdivisionId,metadata.municipality,metadata.zoneCode,source,sourceId,origin,metadata.countryCode && metadata.subdivisionId ? 'confirmed':'pending']);
		return { id:result.insertId,created:true };
	} catch (error) {
		if (error.code !== 'ER_DUP_ENTRY') throw error;
		const duplicate = await findCity({name,country_code:metadata.countryCode,subdivision_id:metadata.subdivisionId,municipality:metadata.municipality,source,source_id:sourceId},query);
		if (duplicate) return {id:duplicate.id,created:false};
		fail('Esta localidade já existe ou precisa de um município para ser distinguida.');
	}
}

async function create(city) {
	if (!city?.country_code) fail('Escolhe o país da cidade.');
	const result = await db.transaction(query => ensureCity(city,query));
	return { ...result,message:result.created ? 'Cidade criada.':'A cidade já existe.' };
}

async function update(id, city) {
	const rows = await get(id);
	if (!rows.length) fail('Cidade não encontrada.',404);
	const input = { ...rows[0],...city };
	if (!Object.prototype.hasOwnProperty.call(city,'state') && (input.country_code !== rows[0].country_code || (Object.prototype.hasOwnProperty.call(city,'subdivision_id') && !city.subdivision_id))) input.state = null;
	const meta = await resolveMetadata(input);
	const name = normalizeCityName(input.name,meta.countryCode);
	if (!name || name.length > 255) fail('Indica um nome válido.');
	await db.query(`UPDATE city SET name=?,state=?,country_code=?,subdivision_id=?,municipality=?,zone_code=?,geography_source='manual',classification_status=? WHERE id=?`,
		[name,meta.state,meta.countryCode,meta.subdivisionId,meta.municipality,meta.zoneCode,meta.countryCode && meta.subdivisionId?'confirmed':'pending',id]);
	return {message:'Cidade atualizada.'};
}

async function remove(id) {
	const result = await db.query('DELETE FROM city WHERE id=?',[id]);
	return {message:result.affectedRows ? 'Cidade apagada.':'Cidade não encontrada.'};
}

module.exports = {normalizeCityName,normalizeCityState,getMultiple,get,create,update,remove,findCity,ensureCity};
