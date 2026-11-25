const db = require('./db');
const { catalogFilter, gigDates, eventDates } = require('./catalogFilters');
const reviewPreview = require('./reviewPreview');
const gigReviews = require('./gigReviews');
const { upcomingGig, editionDate } = require('./concertDates');

function eventType(input = '1') {
	if (!['1', '2'].includes(String(input))) throw Object.assign(new Error('Tipo de espetáculo inválido.'), { statusCode: 400 });
	return Number(input);
}

function selection(kind, type, userId, geography = {}, { target = null, search = null, recent = false, limit = 12, offset = 0 } = {}) {
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
			ORDER BY g.id DESC LIMIT ${target ? 1 : limit}${!target && offset ? ` OFFSET ${offset}` : ''}`, params);
	}
	if (kind === 'review') {
		return gigReviews.getReviews({ type, geography, mediaId: target, search, recent: true,
			limit: target ? 1 : limit, offset: target ? 0 : offset }).then(rows => rows.map(row => ({
			...row, kind: 'review', title: row.artist, image: row.artist_image
		})));
	}
	if (kind === 'photo') {
		const geo = catalogFilter(geography, 'g.city_id', ...gigDates('g'));
		const filters = ['gm.type = ?', 'g.type = ?'];
		params.push('image', type);
		if (target) { filters.push('gm.id = ?'); params.push(target); }
		if (search) {
			filters.push('(a.name LIKE ? OR v.name LIKE ? OR c.name LIKE ? OR gm.url LIKE ? OR u.name LIKE ?)');
			params.push(...Array(5).fill(`%${search}%`));
		}
		params.push(...geo.params);
		return db.query(`SELECT ? AS kind, gm.id, g.id AS gig_id, a.name AS title,
			gm.url AS image, gm.url, u.name AS user_name,
			DATE_FORMAT(g.date, '%Y-%m-%d') AS date,
			COALESCE((SELECT va.name FROM venue_alias va WHERE va.id = g.venue_alias_id AND va.venue_id = v.id), v.name) AS venue, c.name AS city
			FROM gig_media gm INNER JOIN gig g ON g.id = gm.gig_id INNER JOIN artist a ON a.id = g.artist_id
			LEFT JOIN venue v ON v.id = g.venue_id LEFT JOIN city c ON c.id = g.city_id
			LEFT JOIN user u ON u.id = gm.user_id WHERE ${filters.join(' AND ')}${geo.clause}
			ORDER BY gm.id DESC LIMIT ${target ? 1 : limit}${!target && offset ? ` OFFSET ${offset}` : ''}`, [kind, ...params]);
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
		ORDER BY ${orderBy} LIMIT ${target ? 1 : limit}${!target && offset ? ` OFFSET ${offset}` : ''}`, params);
}

async function getFeatured(type, userId = null, geography = {}) {
	const rows = await db.query('SELECT target_kind, target_id FROM home_featured WHERE event_type = ?', [type]);
	if (!rows.length) return null;
	const items = await selection(rows[0].target_kind, type, userId, geography, { target: rows[0].target_id });
	return items[0] || null;
}

async function getSelections(type, userId = null, geography = {}) {
	const rows = await db.query('SELECT slot, target_id FROM home_slide_selection WHERE event_type = ?', [type]);
	const selections = { edition: null, photo: null, review: null };
	await Promise.all(rows.filter(row => Object.hasOwn(selections, row.slot) && !(type === 2 && row.slot === 'edition')).map(async row => {
		const items = await selection(row.slot, type, userId, geography, { target: row.target_id });
		selections[row.slot] = items[0] || null;
	}));
	return selections;
}

async function configuration(type, userId = null) {
	const [featured, selections] = await Promise.all([getFeatured(type, userId), getSelections(type, userId)]);
	return { featured, selections };
}

async function highlights(input, userId, geography) {
	const type = eventType(input);
	const [featured, gigs, editions, selections] = await Promise.all([
		getFeatured(type, userId, geography),
		selection('gig', type, userId, geography, { recent: true }),
		type === 1 ? selection('edition', type, userId, geography, { recent: true }) : [],
		getSelections(type, userId, geography)
	]);
	return { featured, gigs, editions, selections };
}

const creationDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' });

async function recentAdditions(geography = {}) {
	const geo = catalogFilter(geography, 'g.city_id', ...gigDates('g'));
	const joins = `FROM gig g INNER JOIN artist a ON a.id = g.artist_id
		INNER JOIN venue v ON v.id = g.venue_id INNER JOIN city c ON c.id = g.city_id`;
	const where = `g.type = 1 AND ${upcomingGig('g')}${geo.clause}`;
	const artists = await db.query(`SELECT g.artist_id, MAX(g.id) AS latest_id ${joins}
		WHERE ${where} GROUP BY g.artist_id ORDER BY latest_id DESC LIMIT 4`, geo.params);
	if (!artists.length) return { data: [] };
	const rows = await db.query(`SELECT g.id, g.artist_id, a.name AS artist, a.slug AS artist_slug, a.image,
		DATE_FORMAT(g.date, '%Y-%m-%d') AS date,
		DATE_FORMAT(${editionDate('g')}, '%Y-%m-%d') AS edition_date_start,
		DATE_FORMAT(${editionDate('g', 'date_end')}, '%Y-%m-%d') AS edition_date_end,
		UNIX_TIMESTAMP(g.created_at) * 1000 AS created_at_ms,
		COALESCE((SELECT va.name FROM venue_alias va WHERE va.id = g.venue_alias_id AND va.venue_id = v.id), v.name) AS venue,
		c.name AS city ${joins} WHERE ${where} AND g.artist_id IN (${artists.map(() => '?').join(',')})
		ORDER BY COALESCE(g.date, ${editionDate('g')}), g.id`, [...geo.params, ...artists.map(artist => artist.artist_id)]);
	const data = artists.flatMap(artist => {
		const latest = rows.find(row => row.id === artist.latest_id);
		if (!latest) return [];
		const day = latest.created_at_ms == null ? null : creationDay.format(new Date(Number(latest.created_at_ms)));
		// Keep the complete latest day's additions together, including batches larger than a catalogue page.
		const gigs = rows.filter(row => row.artist_id === artist.artist_id && (day == null ? row.id === latest.id
			: row.created_at_ms != null && creationDay.format(new Date(Number(row.created_at_ms))) === day))
			.map(({ created_at_ms, ...row }) => ({ ...row, created_at: created_at_ms == null ? null : new Date(Number(created_at_ms)).toISOString() }));
		return [{ artist_id: latest.artist_id, artist: latest.artist, artist_slug: latest.artist_slug, image: latest.image,
			created_at: latest.created_at_ms == null ? null : new Date(Number(latest.created_at_ms)).toISOString(), gigs }];
	});
	return { data };
}

async function options(input = {}) {
	const type = eventType(input.type);
	const kind = input.kind || 'gig';
	if (!['gig', 'edition', 'photo', 'review'].includes(kind) || (type === 2 && kind === 'edition')) {
		throw Object.assign(new Error('Tipo de conteúdo inválido.'), { statusCode: 400 });
	}
	const search = typeof input.search === 'string' ? input.search.trim().slice(0, 150) : '';
	const page = Number(input.page || 1);
	if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw Object.assign(new Error('Página inválida.'), { statusCode: 400 });
	const rows = await selection(kind, type, null, {}, { search, limit: 13, offset: (page - 1) * 12 });
	return { data: rows.slice(0, 12), hasMore: rows.length > 12, page };
}

async function save(input = {}, userId) {
	const type = eventType(input.type);
	const slot = input.slot || 'featured';
	if (!['featured', 'edition', 'photo', 'review'].includes(slot) || (type === 2 && slot === 'edition')) {
		throw Object.assign(new Error('Slide inválido.'), { statusCode: 400 });
	}
	if (input.kind === null) {
		if (slot === 'featured') await db.query('DELETE FROM home_featured WHERE event_type = ?', [type]);
		else await db.query('DELETE FROM home_slide_selection WHERE event_type = ? AND slot = ?', [type, slot]);
		return configuration(type, userId);
	}
	const target = Number(input.target_id);
	const allowed = slot === 'featured' ? ['gig', ...(type === 1 ? ['edition'] : [])] : [slot];
	if (!allowed.includes(input.kind) || !Number.isSafeInteger(target) || target < 1) {
		throw Object.assign(new Error('Escolhe um conteúdo do tipo deste slide.'), { statusCode: 400 });
	}
	const rows = await selection(input.kind, type, userId, {}, { target });
	if (!rows.length) throw Object.assign(new Error('O conteúdo escolhido já não está disponível.'), { statusCode: 404 });
	if (slot === 'review') {
		try { reviewPreview.normalizeUrl(rows[0].url); }
		catch { throw Object.assign(new Error('A ligação desta crítica não é válida.'), { statusCode: 400 }); }
	}
	if (slot === 'featured') {
		await db.query(`INSERT INTO home_featured (event_type, target_kind, target_id, updated_by)
			VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE target_kind = VALUES(target_kind), target_id = VALUES(target_id), updated_by = VALUES(updated_by)`,
			[type, input.kind, target, userId]);
	} else {
		await db.query(`INSERT INTO home_slide_selection (event_type, slot, target_id, updated_by) VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE target_id = VALUES(target_id), updated_by = VALUES(updated_by)`, [type, slot, target, userId]);
	}
	return configuration(type, userId);
}

module.exports = { highlights, recentAdditions, options, save, getFeatured, getSelections, configuration, eventType };
