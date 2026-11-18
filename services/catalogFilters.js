const { geographyFilter } = require('./geography');
const { editionDate, eventEditionDate } = require('./concertDates');

function day(value) {
	if (value == null || value === '') return null;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
	const parsed = new Date(`${value}T12:00:00Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value || value < '1900-01-01' || value > '2100-12-31') invalid();
	return value;
}

function invalid() { throw Object.assign(new Error('Indica um período de datas válido.'), { statusCode: 400 }); }

function gigDates(alias = 'gig') {
	return [`COALESCE(${alias}.date, ${editionDate(alias)})`, `COALESCE(${alias}.date, ${editionDate(alias, 'date_end')}, ${editionDate(alias)})`];
}

function eventDates(alias = 'event') {
	return [`COALESCE(${alias}.date, ${eventEditionDate(alias)})`, `COALESCE(${alias}.date, ${eventEditionDate(alias, 'date_end')}, ${eventEditionDate(alias)})`];
}

// SQL expressions come only from callers; dates are always bound parameters.
function dateRangeFilter(input = {}, start, end = start) {
	const from = day(input.date_from);
	const to = day(input.date_to);
	if (from && to && from > to) invalid();
	const conditions = [], params = [];
	if (from) { conditions.push(`COALESCE(${end}, ${start}) >= ?`); params.push(from); }
	if (to) { conditions.push(`${start} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(to); }
	const predicate = conditions.join(' AND ');
	return { predicate, clause: predicate ? ` AND ${predicate}` : '', params, active: !!predicate };
}

function catalogFilter(input = {}, city = 'gig.city_id', start = gigDates()[0], end = gigDates()[1]) {
	const geo = geographyFilter(input, city);
	const dates = dateRangeFilter(input, start, end);
	const predicate = [geo.predicate, dates.predicate].filter(Boolean).join(' AND ');
	return { ...geo, predicate, clause: predicate ? ` AND ${predicate}` : '', params: [...geo.params, ...dates.params] };
}

module.exports = { catalogFilter, dateRangeFilter, gigDates, eventDates };
