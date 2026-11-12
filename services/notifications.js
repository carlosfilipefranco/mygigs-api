const { randomUUID } = require('crypto');
const db = require('./db');
const { notificationActor } = require('./notificationContext');
const { upcomingGig } = require('./concertDates');

const defaults = { enabled: true, new_concerts: true, gig_changes: true, onboarding_completed: false };
const entities = {
	artist: { path: '/artistas/', label: 'Artista' },
	festival: { path: '/festivais/', label: 'Festival' },
	edition: { path: '/edicoes/', label: 'Edição' },
	venue: { path: '/locais/', label: 'Local' },
	city: { path: null, label: 'Cidade' },
	gig: { path: '/concertos/', label: 'Concerto' }
};

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function positiveId(value) {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id <= 0) fail('Identificador inválido.');
	return id;
}
function entityType(type) {
	if (!Object.hasOwn(entities, type)) fail('Tipo de interesse inválido.');
	return type;
}

// Table names come exclusively from the fixed whitelist above.
function entityQuery(type) {
	entityType(type);
	if (type === 'gig') return `SELECT g.id, CONCAT(a.name, ' · ', COALESCE(DATE_FORMAT(g.date, '%d/%m/%Y'), 'Dia por anunciar')) AS name,
		CONCAT_WS(' · ', v.name, c.name) AS description FROM gig g
		INNER JOIN artist a ON a.id = g.artist_id LEFT JOIN venue v ON v.id = g.venue_id LEFT JOIN city c ON c.id = g.city_id`;
	const description = type === 'city' ? "CONCAT_WS(' · ', e.country_code, NULLIF(e.state, ''))"
		: type === 'venue' ? '(SELECT c.name FROM city c WHERE c.id = e.city_id)'
		: type === 'edition' ? '(SELECT f.name FROM festival f WHERE f.id = e.festival_id)'
		: "''";
	return `SELECT e.id, e.name, ${description} AS description FROM ${type} e`;
}

function serializeEntity(type, row) {
	return { type, id: row.id, name: row.name, description: row.description || '',
		path: entities[type].path ? entities[type].path + row.id : null };
}

async function settings(userId) {
	const rows = await db.query('SELECT enabled, new_concerts, gig_changes, onboarding_completed FROM user_notification_preferences WHERE user_id = ?', [userId]);
	const preferences = rows.length ? Object.fromEntries(Object.keys(defaults).map(key => [key, Boolean(rows[0][key])])) : { ...defaults };
	const follows = [];
	for (const type of Object.keys(entities)) {
		const alias = type === 'gig' ? 'g' : 'e';
		const rows = await db.query(`${entityQuery(type)} INNER JOIN user_follow uf ON uf.entity_id = ${alias}.id AND uf.entity_type = ? WHERE uf.user_id = ? ORDER BY name, ${alias}.id`, [type, userId]);
		follows.push(...rows.map(row => serializeEntity(type, row)));
	}
	return { preferences, follows };
}

async function savePreferences(userId, payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Preferências inválidas.');
	const keys = Object.keys(payload);
	if (!keys.length || keys.some(key => !Object.hasOwn(defaults, key) || typeof payload[key] !== 'boolean')) fail('Preferências inválidas.');
	await db.query(`INSERT INTO user_notification_preferences (user_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})
		ON DUPLICATE KEY UPDATE ${keys.map(key => `${key} = VALUES(${key})`).join(', ')}`, [userId, ...keys.map(key => Number(payload[key]))]);
	return settings(userId);
}

async function search(type, term = '') {
	entityType(type);
	if (typeof term !== 'string' || term.length > 120) fail('Pesquisa inválida.');
	const alias = type === 'gig' ? 'g' : 'e';
	const field = type === 'gig' ? 'a.name' : 'e.name';
	const rows = await db.query(`${entityQuery(type)} WHERE ${field} LIKE ?${type === 'gig' ? ` AND ${upcomingGig('g')}` : ''} ORDER BY ${field}, ${alias}.id LIMIT 20`, [`%${term.trim()}%`]);
	return { data: rows.map(row => serializeEntity(type, row)) };
}

async function follow(userId, type, identifier) {
	entityType(type);
	const id = positiveId(identifier);
	return db.transaction(async query => {
		// A row lock serializes changes to this user's follows and enforces the limit.
		await query('INSERT IGNORE INTO user_notification_preferences (user_id) VALUES (?)', [userId]);
		await query('SELECT user_id FROM user_notification_preferences WHERE user_id = ? FOR UPDATE', [userId]);
		const rows = await query(`SELECT id FROM ${type} WHERE id = ?`, [id]);
		if (!rows.length) fail('Interesse não encontrado.', 404);
		const existing = await query('SELECT entity_id FROM user_follow WHERE user_id = ? AND entity_type = ? AND entity_id = ?', [userId, type, id]);
		if (!existing.length) {
			const count = await query('SELECT COUNT(*) AS total FROM user_follow WHERE user_id = ?', [userId]);
			if (count[0].total >= 500) fail('Podes seguir até 500 interesses. Remove um antes de adicionar outro.');
			await query('INSERT INTO user_follow (user_id, entity_type, entity_id) VALUES (?, ?, ?)', [userId, type, id]);
		}
		return { following: true };
	});
}

async function unfollow(userId, type, identifier) {
	entityType(type);
	await db.query('DELETE FROM user_follow WHERE user_id = ? AND entity_type = ? AND entity_id = ?', [userId, type, positiveId(identifier)]);
	return { following: false };
}

async function list(userId, before) {
	const cursor = before === undefined ? null : positiveId(before);
	const data = await db.query(`SELECT id, kind, title, body, path, created_at, read_at FROM user_notification
		WHERE user_id = ?${cursor ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT 31`, cursor ? [userId, cursor] : [userId]);
	return { data: data.slice(0, 30), hasMore: data.length > 30, ...await unreadCount(userId) };
}

async function unreadCount(userId) {
	const rows = await db.query('SELECT COUNT(*) AS unread FROM user_notification WHERE user_id = ? AND read_at IS NULL', [userId]);
	return { unread: Number(rows[0].unread) };
}

async function markRead(userId, identifier) {
	await db.query('UPDATE user_notification SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ? AND read_at IS NULL', [userId, positiveId(identifier)]);
	return unreadCount(userId);
}

async function markAllRead(userId, through) {
	// Do not mark notifications that arrived after the last inbox refresh.
	await db.query('UPDATE user_notification SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id <= ? AND read_at IS NULL', [userId, positiveId(through)]);
	return unreadCount(userId);
}

async function gigSnapshot(query, id) {
	const rows = await query(`SELECT g.id, g.artist_id, g.venue_id, g.city_id, g.venue_alias_id,
		DATE_FORMAT(g.date, '%Y-%m-%d') AS date, g.start_time, g.end_time,
		a.name AS artist, v.name AS venue, c.name AS city, ${upcomingGig('g')} AS upcoming
		FROM gig g INNER JOIN artist a ON a.id = g.artist_id
		LEFT JOIN venue v ON v.id = g.venue_id LEFT JOIN city c ON c.id = g.city_id WHERE g.id = ?`, [id]);
	if (!rows.length) return null;
	const editions = await query(`SELECT DISTINCT ed.id, ed.festival_id FROM edition ed INNER JOIN edition_event ee ON ee.edition_id = ed.id
		INNER JOIN event_gig eg ON eg.event_id = ee.event_id WHERE eg.gig_id = ?`, [id]);
	const schedule = await query(`SELECT eg.event_id, eg.start_time, eg.end_time, es.name AS stage FROM event_gig eg
		LEFT JOIN event_stage es ON es.id = eg.stage_id WHERE eg.gig_id = ? ORDER BY eg.event_id`, [id]);
	return { ...rows[0], editions, schedule };
}

function gigTargets(snapshot) {
	if (!snapshot) return [];
	return [['gig', snapshot.id], ['artist', snapshot.artist_id], ['venue', snapshot.venue_id], ['city', snapshot.city_id],
		...snapshot.editions.flatMap(ed => [['edition', ed.id], ['festival', ed.festival_id]])].filter(([, id]) => id);
}

async function deliver(query, kind, targets, title, body, path, actorId = notificationActor()) {
	if (!targets.length) return;
	const unique = [...new Map(targets.map(target => [target.join(':'), target])).values()];
	const predicate = unique.map(() => '(f.entity_type = ? AND f.entity_id = ?)').join(' OR ');
	await query(`INSERT INTO user_notification (user_id, event_key, kind, title, body, path)
		SELECT DISTINCT f.user_id, ?, ?, ?, ?, ? FROM user_follow f
		INNER JOIN user_notification_preferences p ON p.user_id = f.user_id
		WHERE p.enabled = 1 AND p.${kind} = 1 AND (${predicate})${actorId ? ' AND f.user_id <> ?' : ''}`,
		[randomUUID(), kind, title.slice(0, 255), body.slice(0, 2000), path, ...unique.flat(), ...(actorId ? [actorId] : [])]);
}

async function publishGig(query, id, before = null, actorId = notificationActor()) {
	const after = await gigSnapshot(query, id);
	if (!after || (!after.upcoming && !before?.upcoming)) return;
	const changes = [];
	if (before) {
		for (const [field, label] of [['date', 'data'], ['venue_id', 'local'], ['venue_alias_id', 'nome do local'], ['city_id', 'cidade'], ['artist_id', 'artista'], ['start_time', 'hora de início'], ['end_time', 'hora de fim']]) {
			if (String(before[field] ?? '') !== String(after[field] ?? '')) changes.push(label);
		}
		const schedule = snapshot => JSON.stringify(snapshot.schedule.map(({ start_time, end_time, stage }) => ({ start_time, end_time, stage })));
		if (schedule(before) !== schedule(after)) changes.push('horário ou palco');
		if (!changes.length) return;
	}
	const details = [after.artist, after.date ? after.date.split('-').reverse().join('/') : 'Dia por anunciar', after.venue, after.city].filter(Boolean).join(' · ');
	await deliver(query, before ? 'gig_changes' : 'new_concerts', [...gigTargets(before), ...gigTargets(after)],
		before ? `Concerto atualizado: ${after.artist}` : `Novo concerto: ${after.artist}`,
		before ? `${details}. Alterações: ${changes.join(', ')}.` : details, `/concertos/${id}`, actorId);
}

async function editionSnapshot(query, id) {
	const rows = await query(`SELECT id, name, festival_id, venue_id, city_id, venue_alias_id, dates_confirmed,
		DATE_FORMAT(date_start, '%Y-%m-%d') AS date_start, DATE_FORMAT(date_end, '%Y-%m-%d') AS date_end,
		(date_end >= CURDATE()) AS upcoming FROM edition WHERE id = ?`, [id]);
	return rows[0] || null;
}

async function publishEdition(query, id, before, actorId = notificationActor()) {
	const after = await editionSnapshot(query, id);
	if (!before || !after || (!before.upcoming && !after.upcoming)) return;
	const fields = [['date_start', 'data de início'], ['date_end', 'data de fim'], ['dates_confirmed', 'confirmação das datas'], ['venue_id', 'local'], ['venue_alias_id', 'nome do local'], ['city_id', 'cidade']];
	const changes = fields.filter(([field]) => String(before[field] ?? '') !== String(after[field] ?? '')).map(([, label]) => label);
	if (!changes.length) return;
	const targets = snapshot => [['edition', id], ['festival', snapshot.festival_id], ['venue', snapshot.venue_id], ['city', snapshot.city_id]].filter(([, value]) => value);
	// Include followers of the edition's artists and individual concerts as well.
	const gigs = await query(`SELECT DISTINCT g.id, g.artist_id FROM gig g INNER JOIN event_gig eg ON eg.gig_id = g.id
		INNER JOIN edition_event ee ON ee.event_id = eg.event_id WHERE ee.edition_id = ?`, [id]);
	await deliver(query, 'gig_changes', [...targets(before), ...targets(after), ...gigs.flatMap(g => [['gig', g.id], ['artist', g.artist_id]])],
		`Edição atualizada: ${after.name}`, `Alterações: ${changes.join(', ')}. Consulta os detalhes da edição.`, `/edicoes/${id}`, actorId);
}

module.exports = { settings, savePreferences, search, follow, unfollow, list, unreadCount, markRead, markAllRead, gigSnapshot, publishGig, editionSnapshot, publishEdition };
