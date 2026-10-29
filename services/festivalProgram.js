const db = require("./db");
const { buildUniqueSlug, resolveEntityIdByIdentifier } = require("./slug");
const { syncEditionDates } = require("./editionDates");

function fail(message, statusCode = 400) {
	throw Object.assign(new Error(message), { statusCode });
}

function normalizeDate(value) {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Data inválida. Usa YYYY-MM-DD ou deixa o dia por anunciar.");
	const date = new Date(`${value}T12:00:00Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("Data inválida.");
	return value;
}

function normalizeTime(value) {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) fail("Hora inválida.");
	return value.length === 5 ? `${value}:00` : value;
}

async function loadEdition(id, query, lock = false) {
	const rows = await query(`SELECT id, name, venue_id, venue_alias_id, city_id, dates_confirmed,
		DATE_FORMAT(date_start, '%Y-%m-%d') AS date_start, DATE_FORMAT(date_end, '%Y-%m-%d') AS date_end
		FROM edition WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
	if (!rows.length) fail("Edição não encontrada.", 404);
	if (!rows[0].venue_id || !rows[0].city_id) fail("Define o local e a cidade da edição antes de adicionar concertos.");
	return rows[0];
}

function validateEditionDate(edition, date) {
	if (date && edition.dates_confirmed && ((edition.date_start && date < edition.date_start) || (edition.date_end && date > edition.date_end))) {
		fail("O dia do concerto tem de estar dentro das datas oficiais do festival.");
	}
}

async function findFestivalGig(query, editionId, artistId, date, type = 1) {
	const rows = await query(`SELECT g.id, g.artist_id, DATE_FORMAT(g.date, '%Y-%m-%d') AS date,
		g.start_time, g.end_time, g.position, es.name AS stage_name, es.position AS stage_position, eg.event_id
		FROM gig g INNER JOIN event_gig eg ON eg.gig_id = g.id
		INNER JOIN edition_event ee ON ee.event_id = eg.event_id
		LEFT JOIN event_stage es ON es.id = eg.stage_id
		WHERE ee.edition_id = ? AND g.artist_id = ? AND g.type = ?
		AND (? IS NULL OR g.date <=> ? OR g.date IS NULL)
		ORDER BY (g.date <=> ?) DESC, g.id`, [editionId, artistId, type, date, date, date]);
	if (!rows.length) return null;
	if (rows.length > 1) fail("Este artista tem vários concertos nesta edição. Revê os registos antes de atribuir o dia.", 409);
	return rows[0];
}

async function festivalEvent(query, edition, date, type, preferredId = null) {
	const rows = await query(`SELECT e.id FROM event e INNER JOIN edition_event ee ON ee.event_id = e.id
		WHERE ee.edition_id = ? AND e.date <=> ? AND e.type = ? AND e.venue_id = ?
		ORDER BY (e.id = ?) DESC, e.id LIMIT 1 FOR UPDATE`, [edition.id, date, type, edition.venue_id, preferredId]);
	if (rows.length) return { id: rows[0].id, created: false };
	const name = `${edition.name} · ${date || "Dia por anunciar"}`.slice(0, 255);
	const slug = await buildUniqueSlug({ query }, "event", name);
	const result = await query(`INSERT INTO event (name, slug, date, venue_id, city_id, type, venue_alias_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, [name, slug, date, edition.venue_id, edition.city_id, type, edition.venue_alias_id]);
	await query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [edition.id, result.insertId]);
	return { id: result.insertId, created: true };
}

// Move apenas este concerto. Os restantes artistas de um dia ainda por anunciar mantêm-se nesse grupo.
async function placeFestivalGig(query, edition, gigId, date, schedule = {}) {
	validateEditionDate(edition, date);
	const rows = await query(`SELECT g.type, g.venue_id, g.venue_alias_id, g.city_id, g.start_time, g.end_time, eg.event_id, es.name AS stage_name
		FROM gig g LEFT JOIN event_gig eg ON eg.gig_id = g.id
		LEFT JOIN event_stage es ON es.id = eg.stage_id WHERE g.id = ? FOR UPDATE`, [gigId]);
	if (!rows.length) fail("Concerto não encontrado.", 404);
	if (rows.length > 1) fail("Este concerto pertence a vários eventos. Revê as associações antes de alterar o dia.", 409);
	const previous = rows[0];
	const target = await festivalEvent(query, { ...edition, venue_id: previous.venue_id, venue_alias_id: previous.venue_alias_id, city_id: previous.city_id }, date, previous.type, previous.event_id);
	const stageName = schedule.stage_name === undefined ? previous.stage_name : String(schedule.stage_name || "").trim();
	if (stageName && stageName.length > 255) fail("Indica um nome de palco com até 255 caracteres.");
	let stageId = null;
	if (stageName) {
		const stages = await query(`SELECT id, position FROM event_stage WHERE event_id = ? AND name = ? LIMIT 1`, [target.id, stageName]);
		stageId = stages[0]?.id;
		if (!stageId) {
			const stage = await query(`INSERT INTO event_stage (event_id, name, position) VALUES (?, ?, ?)`, [target.id, stageName, Number(schedule.stage_position) || 999]);
			stageId = stage.insertId;
		} else if (schedule.stage_position !== undefined && Number(stages[0].position) !== Number(schedule.stage_position)) {
			await query(`UPDATE event_stage SET position = ? WHERE id = ?`, [Number(schedule.stage_position) || 999, stageId]);
		}
	}
	const start = schedule.start_time === undefined ? previous.start_time : normalizeTime(schedule.start_time);
	const end = schedule.end_time === undefined ? previous.end_time : normalizeTime(schedule.end_time);
	try {
		await query(`UPDATE gig SET date = ?, start_time = ?, end_time = ? WHERE id = ?`, [date, start, end, gigId]);
	} catch (error) {
		if (error.code === "ER_DUP_ENTRY") fail("Já existe um concerto deste artista no mesmo local e dia. Revê os registos para preservar as marcações.", 409);
		throw error;
	}
	if (previous.event_id) {
		await query(`UPDATE event_gig SET event_id = ?, stage_id = ?, start_time = ?, end_time = ? WHERE event_id = ? AND gig_id = ?`, [target.id, stageId, start, end, previous.event_id, gigId]);
	} else {
		await query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)`, [target.id, gigId, stageId, start, end]);
	}
	if (previous.event_id && previous.event_id !== target.id) {
		// Conserva também os bilhetes e o interesse registados no evento provisório.
		await query(`INSERT INTO user_event (user_id, event_id, status, has_ticket, favorite)
			SELECT ue.user_id, ?, CASE WHEN ue.status IN ('going', 'attended') THEN IF(? < CURDATE(), 'attended', 'going') ELSE ue.status END,
			 ue.has_ticket, IF(? < CURDATE(), ue.favorite, 0) FROM user_event ue WHERE ue.event_id = ?
			 AND (ue.has_ticket = 1 OR ue.favorite = 1 OR ue.status = 'wishlist'
			 OR EXISTS (SELECT 1 FROM user_gig ug WHERE ug.user_id = ue.user_id AND ug.gig_id = ? AND ug.status = 'going')
			 OR NOT EXISTS (SELECT 1 FROM user_gig ug INNER JOIN event_gig eg ON eg.gig_id = ug.gig_id
			 WHERE eg.event_id = ue.event_id AND ug.user_id = ue.user_id AND ug.status = 'going'))
			ON DUPLICATE KEY UPDATE has_ticket = GREATEST(user_event.has_ticket, VALUES(has_ticket))`, [target.id, date, date, previous.event_id, gigId]);
		await query(`UPDATE user_event ue SET status = NULL WHERE ue.event_id = ? AND ue.status IN ('going', 'attended')
			AND ue.has_ticket = 0 AND ue.favorite = 0 AND NOT EXISTS
			(SELECT 1 FROM event_gig eg INNER JOIN user_gig ug ON ug.gig_id = eg.gig_id
			 WHERE eg.event_id = ue.event_id AND ug.user_id = ue.user_id AND ug.status = 'going')`, [previous.event_id]);
		// Só elimina o grupo vazio depois de transferir o histórico para o novo evento.
		await query(`DELETE FROM event WHERE id = ? AND NOT EXISTS (SELECT 1 FROM event_gig WHERE event_id = ?)
			AND NOT EXISTS (SELECT 1 FROM edition_event WHERE event_id = ? AND edition_id <> ?)`, [previous.event_id, previous.event_id, previous.event_id, edition.id]);
	}
	await query(`INSERT INTO user_event (user_id, event_id, status, has_ticket)
		SELECT ug.user_id, ?, IF(? < CURDATE(), 'attended', 'going'), COALESCE(ug.has_ticket, 0)
		FROM user_gig ug WHERE ug.gig_id = ? AND ug.status = 'going'
		ON DUPLICATE KEY UPDATE status = VALUES(status), has_ticket = GREATEST(user_event.has_ticket, VALUES(has_ticket))`, [target.id, date, gigId]);
	return target;
}

async function saveProgram(editionIdentifier, slots, type = 1, venue = null) {
	if (!Array.isArray(slots) || !slots.length || slots.length > 1000) fail("Indica entre 1 e 1000 concertos.");
	if (![1, 2].includes(Number(type))) fail("Tipo de evento inválido.");
	return db.transaction(async query => {
		const editionId = await resolveEntityIdByIdentifier({ query }, "edition", editionIdentifier);
		const edition = await loadEdition(editionId, query, true);
		if (venue) {
			edition.venue_id = venue.id;
			edition.venue_alias_id = venue.alias_id;
			edition.city_id = venue.city_id;
		}
		const summary = { created_artists: 0, created_events: 0, created_gigs: 0, updated_gigs: 0, ignored_duplicates: 0, id: null };
		for (const slot of slots) {
			let artistId = Number(slot.artist_id);
			if (!slot.artist_id && typeof slot.artist_name === "string" && slot.artist_name.trim()) {
				const name = slot.artist_name.trim();
				if (name.length > 255) fail("Indica um nome de artista com até 255 caracteres.");
				const artists = await query(`SELECT id, name FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1 FOR UPDATE`, [name]);
				if (artists.length) {
					artistId = artists[0].id;
					const slug = await buildUniqueSlug({ query }, "artist", name, artistId);
					await query(`UPDATE artist SET name = ?, slug = ? WHERE id = ?`, [name, slug, artistId]);
				} else {
					const slug = await buildUniqueSlug({ query }, "artist", name);
					const artist = await query(`INSERT INTO artist (name, slug, image, mbid, type) VALUES (?, ?, '', '', ?)`, [name, slug, Number(type)]);
					artistId = artist.insertId;
					summary.created_artists++;
				}
			}
			if (!Number.isInteger(artistId) || artistId <= 0) fail("Seleciona um artista válido.");
			if (!(await query(`SELECT id FROM artist WHERE id = ?`, [artistId])).length) fail("Artista não encontrado.");
			const date = normalizeDate(slot.date);
			validateEditionDate(edition, date);
			let existing = await findFestivalGig(query, edition.id, artistId, date, type);
			if (!existing && date) {
				const matches = await query(`SELECT g.id, DATE_FORMAT(g.date, '%Y-%m-%d') AS date, g.start_time, g.end_time,
					g.position, eg.event_id, es.name AS stage_name, es.position AS stage_position FROM gig g LEFT JOIN event_gig eg ON eg.gig_id = g.id
					LEFT JOIN event_stage es ON es.id = eg.stage_id WHERE g.artist_id = ? AND g.venue_id = ? AND g.date = ? AND g.type = ? FOR UPDATE`, [artistId, edition.venue_id, date, Number(type)]);
				if (matches.length > 1) fail("Há várias associações para este concerto. Revê os registos antes de importar.", 409);
				if (matches.length) {
					existing = matches[0];
					if (existing.event_id) {
						const linked = await query(`SELECT edition_id FROM edition_event WHERE event_id = ? AND edition_id <> ?`, [existing.event_id, edition.id]);
						if (linked.length) fail("Este concerto já pertence a outra edição.", 409);
						await query(`INSERT IGNORE INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [edition.id, existing.event_id]);
					}
				}
			}
			// Reimportar um cartaz sem dias nunca apaga um dia já confirmado.
			if (existing?.date && !date) {
				summary.ignored_duplicates++;
				summary.id ||= existing.event_id;
				continue;
			}
			if (existing && existing.date === date && existing.event_id
				&& (slot.stage_name === undefined || (existing.stage_name || "Sem palco") === (slot.stage_name || "Sem palco"))
				&& (slot.start_time === undefined || existing.start_time === normalizeTime(slot.start_time))
				&& (slot.end_time === undefined || existing.end_time === normalizeTime(slot.end_time))
				&& (slot.stage_position === undefined || Number(existing.stage_position) === Number(slot.stage_position))
				&& (slot.position === undefined || Number(existing.position) === Number(slot.position))) {
				summary.ignored_duplicates++;
				summary.id ||= existing.event_id;
				continue;
			}
			let gigId = existing?.id;
			if (!gigId) {
				const result = await query(`INSERT INTO gig (artist_id, venue_id, venue_alias_id, city_id, date, type, position)
					VALUES (?, ?, ?, ?, ?, ?, ?)`, [artistId, edition.venue_id, edition.venue_alias_id, edition.city_id, date, Number(type), Number(slot.position) || 0]);
				gigId = result.insertId;
				summary.created_gigs++;
			} else {
				summary.updated_gigs++;
			}
			const target = await placeFestivalGig(query, edition, gigId, date, slot);
			if (slot.position !== undefined) await query(`UPDATE gig SET position = ? WHERE id = ?`, [Number(slot.position) || 0, gigId]);
			if (target.created) summary.created_events++;
			summary.id ||= target.id;
		}
		await syncEditionDates(edition.id, query);
		return { ...summary, message: "Programa guardado com sucesso." };
	}, { lockName: "festival-program" });
}

module.exports = { normalizeDate, loadEdition, validateEditionDate, findFestivalGig, placeFestivalGig, saveProgram };
