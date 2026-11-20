const db = require('./db');
const { catalogFilter, gigDates, eventDates } = require('./catalogFilters');
const { upcomingGig, editionDate } = require('./concertDates');

function eventType(input = '1') {
	if (!['1', '2'].includes(String(input))) throw Object.assign(new Error('Tipo de espetáculo inválido.'), { statusCode: 400 });
	return Number(input);
}

function selection(kind, type, userId, geography = {}, { target = null, search = null, recent = false } = {}) {
	const params = [];
	if (kind === 'gig') {
		const geo = catalogFilter(geography, 'g.city_id', ...gigDates('g'));
		const filters = ['g.type = ?'];
		params.push(userId || null, type);
		if (target) { filters.push('g.id = ?'); params.push(target); }
		if (recent) filters.push(upcomingGig('g'));
		if (search) {
			filters.push('(a.name LIKE ? OR v.name LIKE ? OR c.name LIKE ?)');
			params.push(...Array(3).fill(`%${search}%`));
		}
		params.push(...geo.params);
		return db.query(`SELECT 'gig' AS kind, g.id, a.name AS title, a.image,
			DATE_FORMAT(g.date, '%Y-%m-%d') AS date, DATE_FORMAT(${editionDate('g')}, '%Y-%m-%d') AS edition_date,
			COALESCE((SELECT va.name FROM venue_alias va WHERE va.id = g.venue_alias_id AND va.venue_id = v.id), v.name) AS venue,
			c.name AS city, COALESCE(ug.status, 'not_going') AS status
			FROM gig g INNER JOIN artist a ON a.id = g.artist_id
			INNER JOIN venue v ON v.id = g.venue_id LEFT JOIN city c ON c.id = g.city_id
			LEFT JOIN user_gig ug ON ug.gig_id = g.id AND ug.user_id = ?
			WHERE ${filters.join(' AND ')}${geo.clause}
			ORDER BY g.id DESC LIMIT ${target ? 1 : 12}`, params);
	}
	const geo = catalogFilter(geography, 'e.city_id', 'e.date_start', 'COALESCE(e.date_end, e.date_start)');
	const filters = ['1=1'];
	if (target) { filters.push('e.id = ?'); params.push(target); }
	if (recent) filters.push('DATE(e.date_start) > CURDATE()');
	if (search) { filters.push('(e.name LIKE ? OR f.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
	params.push(...geo.params);
	// New lineup entries create gigs; editing their date, stage or time keeps the same ID.
	const confirmations = recent ? `INNER JOIN (
		SELECT ee.edition_id, MAX(g.id) AS latest_gig_id
		FROM edition_event ee INNER JOIN event_gig eg ON eg.event_id = ee.event_id
		INNER JOIN gig g ON g.id = eg.gig_id AND g.type = 1
		GROUP BY ee.edition_id
	) confirmations ON confirmations.edition_id = e.id` : '';
	const orderBy = recent ? 'confirmations.latest_gig_id DESC, e.id DESC' : 'e.date_start DESC, e.id DESC';
	return db.query(`SELECT 'edition' AS kind, e.id, e.name AS title, COALESCE(NULLIF(e.image, ''), f.image) AS image,
		DATE_FORMAT(e.date_start, '%Y-%m-%d') AS date, DATE_FORMAT(e.date_end, '%Y-%m-%d') AS date_end,
		v.name AS venue, c.name AS city
		FROM edition e INNER JOIN festival f ON f.id = e.festival_id
		${confirmations}
		LEFT JOIN venue v ON v.id = e.venue_id LEFT JOIN city c ON c.id = e.city_id
		WHERE ${filters.join(' AND ')}${geo.clause}
		ORDER BY ${orderBy} LIMIT ${target ? 1 : 12}`, params);
}

async function getFeatured(type, userId = null, geography = {}) {
	const rows = await db.query('SELECT target_kind, target_id FROM home_featured WHERE event_type = ?', [type]);
	if (!rows.length) return null;
	const items = await selection(rows[0].target_kind, type, userId, geography, { target: rows[0].target_id });
	return items[0] || null;
}

async function highlights(input, userId, geography) {
	const type = eventType(input);
	const [featured, gigs, editions] = await Promise.all([
		getFeatured(type, userId, geography),
		selection('gig', type, userId, geography, { recent: true }),
		type === 1 ? selection('edition', type, userId, geography, { recent: true }) : []
	]);
	return { featured, gigs, editions };
}

async function options(input = {}) {
	const type = eventType(input.type);
	const kind = input.kind || 'gig';
	if (!['gig', 'edition'].includes(kind) || (type === 2 && kind === 'edition')) {
		throw Object.assign(new Error('Escolhe um concerto ou uma edição de festival.'), { statusCode: 400 });
	}
	const search = typeof input.search === 'string' ? input.search.trim().slice(0, 150) : '';
	return { data: await selection(kind, type, null, {}, { search }) };
}

async function save(input = {}, userId) {
	const type = eventType(input.type);
	if (input.kind === null) {
		await db.query('DELETE FROM home_featured WHERE event_type = ?', [type]);
		return { featured: null };
	}
	const target = Number(input.target_id);
	if (!['gig', 'edition'].includes(input.kind) || (type === 2 && input.kind === 'edition') || !Number.isSafeInteger(target) || target < 1) {
		throw Object.assign(new Error('Escolhe um concerto ou uma edição de festival.'), { statusCode: 400 });
	}
	const rows = await selection(input.kind, type, userId, {}, { target });
	if (!rows.length) throw Object.assign(new Error('O conteúdo escolhido já não está disponível.'), { statusCode: 404 });
	await db.query(`INSERT INTO home_featured (event_type, target_kind, target_id, updated_by)
		VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE target_kind = VALUES(target_kind), target_id = VALUES(target_id), updated_by = VALUES(updated_by)`,
		[type, input.kind, target, userId]);
	return { featured: rows[0] };
}

module.exports = { highlights, options, save, getFeatured, eventType };
