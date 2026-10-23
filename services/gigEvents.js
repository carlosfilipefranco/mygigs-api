const db = require("./db");
const { buildUniqueSlug } = require("./slug");
const { getEditionIdsForEvent, syncEditionDatesForEditionIds } = require("./editionDates");

const gigFields = `g.id, DATE_FORMAT(g.date, '%Y-%m-%d') AS date, g.artist_id,
	g.city_id, g.venue_id, g.type, g.start_time, g.end_time,
	a.name AS artist, a.image AS artist_image`;

async function missingGigs(query) {
	return query(
		`SELECT ${gigFields}
		 FROM gig g INNER JOIN artist a ON a.id = g.artist_id
		 WHERE NOT EXISTS (SELECT 1 FROM event_gig eg WHERE eg.gig_id = g.id)
		 ORDER BY g.date, g.venue_id, g.position, g.id`
	);
}

async function matchingEvents(gig, query, lock = false) {
	// Sem data, não há informação suficiente para juntar concertos distintos.
	if (!gig.date) return [];
	return query(
		`SELECT id FROM event WHERE date = ? AND city_id <=> ? AND venue_id = ? AND type <=> ? ORDER BY id${lock ? " FOR UPDATE" : ""}`,
		[gig.date, gig.city_id, gig.venue_id, gig.type]
	);
}

async function eventName(gig, query) {
	if (!gig.date) return gig.artist.slice(0, 255);
	const artists = await query(
		`SELECT a.name FROM gig g INNER JOIN artist a ON a.id = g.artist_id
		 WHERE g.date = ? AND g.city_id <=> ? AND g.venue_id = ? AND g.type <=> ?
		 ORDER BY g.position, g.id`,
		[gig.date, gig.city_id, gig.venue_id, gig.type]
	);
	return [...new Set(artists.map((artist) => artist.name))].join(" + ").slice(0, 255);
}

async function syncUserHistory(eventId, query) {
	// Criar apenas as relações em falta, preservando estados, bilhetes e favoritos já existentes.
	await query(
		`INSERT INTO user_event (user_id, event_id, status, has_ticket)
		 SELECT ug.user_id, e.id,
		        CASE WHEN e.date < CURDATE() THEN 'attended' ELSE 'going' END,
		        MAX(COALESCE(ug.has_ticket, 0))
		 FROM event_gig eg
		 INNER JOIN event e ON e.id = eg.event_id
		 INNER JOIN user_gig ug ON ug.gig_id = eg.gig_id
		 WHERE eg.event_id = ? AND ug.status = 'going'
		 GROUP BY ug.user_id, e.id, e.date
		 ON DUPLICATE KEY UPDATE id = user_event.id`,
		[eventId]
	);
}

async function ensureGigEvent(gigId, query, { sourceUrl = null } = {}) {
	const rows = await query(`SELECT ${gigFields} FROM gig g INNER JOIN artist a ON a.id = g.artist_id WHERE g.id = ?`, [gigId]);
	if (!rows.length) throw new Error("Concerto não encontrado.");
	const gig = rows[0];
	// Serializar a escolha/criação de eventos no mesmo local entre importações.
	await query(`SELECT id FROM venue WHERE id = ? FOR UPDATE`, [gig.venue_id]);
	const linked = await query(`SELECT event_id FROM event_gig WHERE gig_id = ? ORDER BY event_id LIMIT 1 FOR UPDATE`, [gigId]);
	if (linked.length) return { event_id: linked[0].event_id, created: false, linked: false };
	const matches = await matchingEvents(gig, query, true);
	if (matches.length > 1) {
		const error = new Error(`Há vários eventos para o concerto ${gigId}. Indica o ID do evento na importação.`);
		error.statusCode = 409;
		throw error;
	}
	let eventId = matches[0]?.id || null;
	let created = false;
	if (!eventId) {
		const name = await eventName(gig, query);
		const slug = await buildUniqueSlug({ query }, "event", name.slice(0, 160));
		const image = name === gig.artist && gig.artist_image && gig.artist_image !== "null" ? gig.artist_image : null;
		const result = await query(
			`INSERT INTO event (name, slug, date, city_id, venue_id, type, image, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[name, slug, gig.date, gig.city_id, gig.venue_id, gig.type, image,
				sourceUrl ? `Importado de setlist.fm: ${sourceUrl}` : null]
		);
		eventId = result.insertId;
		created = true;
	}
	await query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, NULL, ?, ?)`, [eventId, gigId, gig.start_time, gig.end_time]);
	await syncUserHistory(eventId, query);
	await syncEditionDatesForEditionIds(await getEditionIdsForEvent(eventId, query), query);
	return { event_id: eventId, created, linked: true };
}

async function backfillMissingEvents({ apply = false, beforeApply } = {}) {
	return db.transaction(async (query) => {
		const gigs = await missingGigs(query);
		const groups = new Map();
		for (const gig of gigs) {
			const key = gig.date ? JSON.stringify([gig.date, gig.city_id, gig.venue_id, gig.type]) : `undated:${gig.id}`;
			if (!groups.has(key)) {
				const matches = await matchingEvents(gig, query);
				groups.set(key, { name: await eventName(gig, query), date: gig.date, gig_ids: [], event_ids: matches.map((event) => event.id) });
			}
			groups.get(key).gig_ids.push(gig.id);
		}
		const plan = [...groups.values()];
		const summary = { missing_gigs: gigs.length, undated_gigs: gigs.filter((gig) => !gig.date).length,
			planned_events: plan.filter((group) => !group.event_ids.length).length,
			ambiguous_groups: plan.filter((group) => group.event_ids.length > 1).length,
			created_events: 0, linked_gigs: 0 };
		if (!apply || !gigs.length) return { applied: false, summary, plan, results: [] };
		if (summary.ambiguous_groups) throw new Error("Há concertos com vários eventos possíveis. Resolve essas associações antes de aplicar a correção.");
		if (beforeApply) {
			const [events, eventGigs, userEvents] = await Promise.all([
				query(`SELECT * FROM event`), query(`SELECT * FROM event_gig`), query(`SELECT * FROM user_event`)
			]);
			await beforeApply({ gigs, events, event_gigs: eventGigs, user_events: userEvents });
		}
		const results = [];
		for (const gig of gigs) {
			const result = await ensureGigEvent(gig.id, query);
			if (result.created) summary.created_events++;
			if (result.linked) summary.linked_gigs++;
			results.push({ gig_id: gig.id, ...result });
		}
		return { applied: true, summary, plan, results };
	});
}

module.exports = { ensureGigEvent, backfillMissingEvents };
