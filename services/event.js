const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const eventImageStorage = require("./eventImageStorage");
const { resolveEntityIdByIdentifier, buildUniqueSlug } = require("./slug");
const { syncEditionDates, syncEditionDatesForEditionIds, getEditionIdsForEvent } = require("./editionDates");

function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeTime(value) {
	if (!value || typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const match = trimmed.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) {
		return null;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3] || "0");

	if (hours > 23 || minutes > 59 || seconds > 59) {
		return null;
	}

	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeDate(value) {
	if (value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) {
		return undefined;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	const isValid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

	if (!isValid) {
		return undefined;
	}

	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeStageName(value) {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeStageKey(value) {
	return normalizeStageName(value)?.toLowerCase() || null;
}

function normalizeNumber(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return parsed;
}

function extractStageName(slot) {
	return normalizeStageName(slot?.stage_name || slot?.stage?.name || slot?.stage);
}

function extractArtistId(slot) {
	return normalizeNumber(slot?.artist_id || slot?.artist?.id || slot?.id);
}

function normalizeArtistSlots(artists) {
	if (!Array.isArray(artists)) {
		return [];
	}

	return artists
		.map((entry) => {
			if (!entry) {
				return null;
			}

			const artist = entry.artist && typeof entry.artist === "object" ? entry.artist : entry;
			const artistId = extractArtistId({ ...entry, artist });

			if (!artistId) {
				return null;
			}

			return {
				artist_id: artistId,
				stage_id: normalizeNumber(entry.stage_id),
				stage_name: extractStageName(entry),
				start_time: normalizeTime(entry.start_time),
				end_time: normalizeTime(entry.end_time)
			};
		})
		.filter(Boolean);
}

async function getEventStageRows(eventId) {
	return db.query(
		`
		SELECT id, name, position
		FROM event_stage
		WHERE event_id = ?
		ORDER BY position ASC, id ASC
		`,
		[eventId]
	);
}

async function ensureEventStages(eventId, stageInput = [], slotInput = []) {
	const existing = await getEventStageRows(eventId);
	const byId = new Map(existing.map((stage) => [stage.id, stage]));
	const byKey = new Map(existing.map((stage) => [normalizeStageKey(stage.name), stage]));
	const normalizedStages = [];

	if (Array.isArray(stageInput)) {
		for (let i = 0; i < stageInput.length; i++) {
			const stage = stageInput[i];
			if (!stage) {
				continue;
			}

			const id = normalizeNumber(stage.id || stage.stage_id);
			const name = normalizeStageName(stage.name || stage.stage_name || stage.stage);
			if (!name) {
				continue;
			}

			normalizedStages.push({
				id,
				name,
				position: Number.isFinite(Number(stage.position)) ? Number(stage.position) : i + 1
			});
		}
	}

	const stageNamesFromSlots = [];
	for (const slot of slotInput || []) {
		const stageName = extractStageName(slot);
		if (stageName) {
			stageNamesFromSlots.push(stageName);
		}
	}

	for (const stageName of stageNamesFromSlots) {
		if (!normalizedStages.some((stage) => normalizeStageKey(stage.name) === normalizeStageKey(stageName))) {
			normalizedStages.push({
				id: null,
				name: stageName,
				position: normalizedStages.length + 1
			});
		}
	}

	for (let i = 0; i < normalizedStages.length; i++) {
		const stage = normalizedStages[i];
		const position = Number.isFinite(stage.position) ? stage.position : i + 1;
		let persistedStage = null;

		if (stage.id && byId.has(stage.id)) {
			persistedStage = byId.get(stage.id);
			if (persistedStage.name !== stage.name || Number(persistedStage.position) !== Number(position)) {
				await db.query(`UPDATE event_stage SET name=?, position=? WHERE id=? AND event_id=?`, [stage.name, position, persistedStage.id, eventId]);
			}
		} else {
			const key = normalizeStageKey(stage.name);
			if (key && byKey.has(key)) {
				persistedStage = byKey.get(key);
				if (Number(persistedStage.position) !== Number(position)) {
					await db.query(`UPDATE event_stage SET position=? WHERE id=? AND event_id=?`, [position, persistedStage.id, eventId]);
				}
			} else {
				const result = await db.query(`INSERT INTO event_stage (event_id, name, position) VALUES (?, ?, ?)`, [eventId, stage.name, position]);
				persistedStage = { id: result.insertId, name: stage.name, position };
			}
		}

		if (persistedStage) {
			byId.set(persistedStage.id, persistedStage);
			const key = normalizeStageKey(persistedStage.name);
			if (key) {
				byKey.set(key, persistedStage);
			}
		}
	}

	const rows = await getEventStageRows(eventId);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	const rowsByKey = new Map(rows.map((row) => [normalizeStageKey(row.name), row]));

	return {
		rows,
		rowsById,
		rowsByKey
	};
}

function resolveStageId(slot, stageLookup) {
	if (!slot || !stageLookup) {
		return null;
	}

	const explicitStageId = normalizeNumber(slot.stage_id);
	if (explicitStageId && stageLookup.rowsById.has(explicitStageId)) {
		return explicitStageId;
	}

	const stageName = extractStageName(slot);
	const key = normalizeStageKey(stageName);
	if (key && stageLookup.rowsByKey.has(key)) {
		return stageLookup.rowsByKey.get(key).id;
	}

	return null;
}

async function getMultiple(page = 1, search = null, type = 1, period = null, userId = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	const filters = ["event.type = ?"];
	const params = [Number(type) || 1];
	const normalizedSearch = search ? search.toLowerCase() : null;
	let orderBy = "event.date DESC";

	if (search) {
		filters.push("(LOWER(event.name) LIKE ? OR LOWER(event.description) LIKE ? OR LOWER(venue.name) LIKE ? OR LOWER(city.name) LIKE ? OR LOWER(event.date) LIKE ?)");
		params.push(`%${normalizedSearch}%`, `%${normalizedSearch}%`, `%${normalizedSearch}%`, `%${normalizedSearch}%`, `%${normalizedSearch}%`);
	}

	if (period === "upcoming") {
		filters.push("event.date >= CURDATE()");
		orderBy = "event.date ASC";
	}

	if (period === "past") {
		filters.push("event.date < CURDATE()");
		orderBy = "event.date DESC";
	}

	const where = `WHERE ${filters.join(" AND ")}`;
	const userEventSelect = userId ? ", user_event.status, user_event.has_ticket, user_event.favorite" : "";
	const userEventJoin = userId ? "LEFT JOIN user_event ON user_event.event_id = event.id AND user_event.user_id = ?" : "";
	const queryParams = userId ? [userId, ...params] : params;
	const rows = await db.query(
		`SELECT
			event.id,
			event.date,
			event.name,
			event.slug,
			event.image,
			event.description,
			venue.name as venue,
			city.name as city,
			(
				SELECT COUNT(*)
				FROM user_event uec
				WHERE uec.event_id = event.id
				  AND uec.status = 'attended'
			) AS went_count,
			(
				SELECT COUNT(*)
				FROM user_event uec
				WHERE uec.event_id = event.id
				  AND uec.status IN ('wishlist', 'going')
			) AS interested_count
			${userEventSelect}
		FROM event
		INNER JOIN venue ON event.venue_id = venue.id
		INNER JOIN city ON event.city_id = city.id
		${userEventJoin}
		${where}
		ORDER BY ${orderBy}
		LIMIT ${offset},${config.listPerPage}`,
		queryParams
	);

	const countRows = await db.query(
		`SELECT COUNT(*) as count
		FROM event
		INNER JOIN venue ON event.venue_id = venue.id
		INNER JOIN city ON event.city_id = city.id
		${where}`,
		params
	);
	const count = countRows[0].count;
	const data = helper.emptyOrRows(rows);
	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function get(id, userId = null) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "event", id);
	if (!resolvedId) {
		return null;
	}

	const userEventSelect = userId ? ", ue.status AS user_event_status, ue.has_ticket AS user_event_has_ticket, ue.favorite AS user_event_favorite" : "";
	const userEventJoin = userId ? "LEFT JOIN user_event ue ON ue.event_id = e.id AND ue.user_id = ?" : "";
	const userGigSelect = userId ? ", ug.status AS user_gig_status, ug.favorite AS user_gig_favorite" : "";
	const userGigJoin = userId ? "LEFT JOIN user_gig ug ON ug.gig_id = g.id AND ug.user_id = ?" : "";
	const params = userId ? [userId, userId, resolvedId] : [resolvedId];
	const result = await db.query(
		`
		SELECT e.id AS event_id, e.name AS event_name, e.slug AS event_slug, e.image AS event_image, e.description AS event_description, e.type AS event_type${userEventSelect}${userGigSelect},
		       (
		       	SELECT COUNT(*)
		       	FROM user_event uec
		       	WHERE uec.event_id = e.id
		       	  AND uec.status = 'attended'
		       ) AS went_count,
		       (
		       	SELECT COUNT(*)
		       	FROM user_event uec
		       	WHERE uec.event_id = e.id
		       	  AND uec.status IN ('wishlist', 'going')
		       ) AS interested_count,
		       g.date,
		       g.start_time AS gig_start_time,
		       g.end_time AS gig_end_time,
		       eg.start_time AS event_start_time,
		       eg.end_time AS event_end_time,
		       eg.stage_id,
		       es.name AS stage_name,
		       es.position AS stage_position,
		       g.id AS gig_id,
		       v.id AS venue_id,
		       v.name AS venue,
		       c.id AS city_id,
		       c.name AS city,
		       a.id AS artist_id,
		       a.name AS artist,
		       a.slug AS artist_slug,
		       a.image AS artist_image
		FROM event e
		INNER JOIN event_gig eg ON e.id = eg.event_id
		INNER JOIN gig g ON eg.gig_id = g.id
		INNER JOIN venue v ON g.venue_id = v.id
		INNER JOIN city c ON g.city_id = c.id
		INNER JOIN artist a ON g.artist_id = a.id
		LEFT JOIN event_stage es ON es.id = eg.stage_id
		${userEventJoin}
		${userGigJoin}
		WHERE e.id = ?
		ORDER BY
			CASE WHEN COALESCE(eg.start_time, g.start_time) IS NULL THEN 1 ELSE 0 END,
			COALESCE(eg.start_time, g.start_time) ASC,
			es.position ASC,
			a.name ASC
	`,
		params
	);

	if (result.length === 0) {
		return null;
	}

	const stageRows = await getEventStageRows(resolvedId);
	const { event_name, event_image, event_description, event_type } = result[0];

	const gigs = result.map((row) => ({
		id: row.gig_id,
		date: row.date,
		start_time: row.event_start_time || row.gig_start_time || null,
		end_time: row.event_end_time || row.gig_end_time || null,
		stage_id: row.stage_id || null,
		stage_name: row.stage_name || null,
		venue_id: row.venue_id,
		venue: row.venue,
		city_id: row.city_id,
		city: row.city,
		artist_id: row.artist_id,
		artist: row.artist,
		artist_slug: row.artist_slug,
		artist_image: row.artist_image,
		user_gig: {
			status: row.user_gig_status || "not_going",
			favorite: !!row.user_gig_favorite
		}
	}));

	return {
		id: Number(result[0].event_id),
		name: event_name,
		slug: result[0].event_slug || null,
		image: event_image,
		description: event_description,
		type: event_type,
		stages: stageRows.map((stage) => ({
			id: stage.id,
			name: stage.name,
			position: stage.position
		})),
		went_count: Number(result[0].went_count || 0),
		interested_count: Number(result[0].interested_count || 0),
		user_event: {
			status: result[0].user_event_status || null,
			has_ticket: !!result[0].user_event_has_ticket,
			favorite: !!result[0].user_event_favorite
		},
		gigs
	};
}

async function create(event) {
	const slots = normalizeArtistSlots(event.artists);
	const cityId = normalizeNumber(event?.city?.id || event?.city_id || event?.city);
	const venueId = normalizeNumber(event?.venue?.id || event?.venue_id || event?.venue);
	const type = Number(event?.type) || 1;
	let name = event?.name || null;

	if (!name && slots.length) {
		const fallbackArtist = await db.query(`SELECT name FROM artist WHERE id=? LIMIT 1`, [slots[slots.length - 1].artist_id]);
		name = fallbackArtist?.[0]?.name || null;
	}

	if (!name || !event?.date || !cityId || !venueId) {
		throw new Error("Missing required event fields");
	}

	const slug = await buildUniqueSlug(db, "event", name);
	const resultEvent = await db.query(`INSERT INTO event (name, slug, date, city_id, venue_id, type, description) VALUES (?, ?, ?, ?, ?, ?, ?)`, [name, slug, event.date, cityId, venueId, type, event.description || null]);
	const eventId = resultEvent.insertId;

	if (event.image) {
		try {
			const storedImage = await eventImageStorage.storeEventImage({
				id: eventId,
				name,
				image: event.image,
				replaceExisting: true
			});

			if (storedImage.image) {
				await db.query(`UPDATE event SET image=? WHERE id=?`, [storedImage.image, eventId]);
			}
		} catch (error) {
			console.error(`Error while storing event image`, error.message);
		}
	}

	const stageLookup = await ensureEventStages(eventId, event.stages, slots);

	for (const slot of slots) {
		const resultGig = await db.query(
			`INSERT INTO gig (date, city_id, venue_id, artist_id, type, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[event.date, cityId, venueId, slot.artist_id, type, slot.start_time, slot.end_time]
		);

		const stageId = resolveStageId(slot, stageLookup);
		await db.query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)`, [eventId, resultGig.insertId, stageId, slot.start_time, slot.end_time]);
	}

	if (event.edition) {
		const editionId = normalizeNumber(event.edition.edition_id || event.edition.id || event.edition);
		if (!editionId) {
			throw new Error("Edição inválida");
		}
		await db.query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [editionId, eventId]);
		await syncEditionDates(editionId);
	}

	let message = "Error in creating Edition";

	if (resultEvent.affectedRows) {
		message = "Event created successfully";
	}

	return { message };
}

async function dashboard(type = 1) {
	const total_events = await db.query(`SELECT COUNT(*) AS total_events FROM event WHERE type = ?`, [type]);
	const events_by_year = await db.query(`SELECT YEAR(date) AS year, COUNT(*) AS event_count FROM event WHERE type = ? GROUP BY YEAR(date) ORDER BY YEAR(date);`, [type]);

	return {
		total_events: total_events[0],
		events_by_year
	};
}

async function remove(id) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "event", id);
	if (!resolvedId) {
		return { message: "Event not found" };
	}

	const result = await db.transaction(async (query) => {
		const linkedEditionIds = await getEditionIdsForEvent(resolvedId, query);
		const gigRows = await query(`SELECT gig_id FROM event_gig WHERE event_id = ?`, [resolvedId]);
		const gigIds = [...new Set(gigRows.map((row) => Number(row.gig_id)).filter(Boolean))];

		if (gigIds.length) {
			const placeholders = gigIds.map(() => "?").join(",");
			await query(`DELETE FROM setlist_song WHERE setlist_id IN (SELECT id FROM setlist WHERE gig_id IN (${placeholders}))`, gigIds);
			await query(`DELETE FROM setlist WHERE gig_id IN (${placeholders})`, gigIds);
			await query(`DELETE FROM gig_media WHERE gig_id IN (${placeholders})`, gigIds);
			await query(`DELETE FROM user_gig WHERE gig_id IN (${placeholders})`, gigIds);
		}

		await query(`DELETE FROM event_gig WHERE event_id=?`, [resolvedId]);
		await query(`DELETE FROM event_stage WHERE event_id=?`, [resolvedId]);
		await query(`DELETE FROM edition_event WHERE event_id=?`, [resolvedId]);
		const deleteEventResult = await query(`DELETE FROM event WHERE id=?`, [resolvedId]);

		if (gigIds.length) {
			const placeholders = gigIds.map(() => "?").join(",");
			await query(`DELETE FROM gig WHERE id IN (${placeholders})`, gigIds);
		}

		await syncEditionDatesForEditionIds(linkedEditionIds, query);

		return deleteEventResult;
	});

	let message = "Error in deleting Edition";

	if (result.affectedRows) {
		message = "Edition deleted successfully";
	}

	return { message };
}

async function update(id, event) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "event", id);
	if (!resolvedId) {
		throw new Error("Event not found");
	}

	const linkedEditionIds = await getEditionIdsForEvent(resolvedId);
	const slug = await buildUniqueSlug(db, "event", event?.name, resolvedId);
	const storedImage = await eventImageStorage.storeEventImage({
		id: resolvedId,
		name: event.name,
		image: event.image,
		replaceExisting: true
	});

	const nextDate = hasOwn(event, "date") ? normalizeDate(event.date) : undefined;
	const nextCityId = hasOwn(event, "city") || hasOwn(event, "city_id") ? normalizeNumber(event?.city?.id || event?.city_id || event?.city) : undefined;
	const nextVenueId = hasOwn(event, "venue") || hasOwn(event, "venue_id") ? normalizeNumber(event?.venue?.id || event?.venue_id || event?.venue) : undefined;
	const nextType = hasOwn(event, "type") ? Number(event.type) || null : undefined;

	if (hasOwn(event, "date") && nextDate === undefined) {
		throw new Error("Data inválida. Usa o formato YYYY-MM-DD.");
	}
	if ((hasOwn(event, "city") || hasOwn(event, "city_id")) && !nextCityId) {
		throw new Error("Cidade inválida.");
	}
	if ((hasOwn(event, "venue") || hasOwn(event, "venue_id")) && !nextVenueId) {
		throw new Error("Local inválido.");
	}
	if (hasOwn(event, "type") && !nextType) {
		throw new Error("Tipo inválido.");
	}

	const eventFields = ["name=?", "slug=?", "image=?", "description=?"];
	const eventParams = [event.name, slug, storedImage.image || null, event.description || null];
	if (hasOwn(event, "date")) {
		eventFields.push("date=?");
		eventParams.push(nextDate);
	}
	if (hasOwn(event, "city") || hasOwn(event, "city_id")) {
		eventFields.push("city_id=?");
		eventParams.push(nextCityId);
	}
	if (hasOwn(event, "venue") || hasOwn(event, "venue_id")) {
		eventFields.push("venue_id=?");
		eventParams.push(nextVenueId);
	}
	if (hasOwn(event, "type")) {
		eventFields.push("type=?");
		eventParams.push(nextType);
	}

	const result = await db.query(`UPDATE event SET ${eventFields.join(", ")} WHERE id=?`, [...eventParams, resolvedId]);
	const gigSyncFields = [];
	const gigSyncParams = [];
	if (hasOwn(event, "date")) {
		gigSyncFields.push("g.date=?");
		gigSyncParams.push(nextDate);
	}
	if (hasOwn(event, "city") || hasOwn(event, "city_id")) {
		gigSyncFields.push("g.city_id=?");
		gigSyncParams.push(nextCityId);
	}
	if (hasOwn(event, "venue") || hasOwn(event, "venue_id")) {
		gigSyncFields.push("g.venue_id=?");
		gigSyncParams.push(nextVenueId);
	}
	if (hasOwn(event, "type")) {
		gigSyncFields.push("g.type=?");
		gigSyncParams.push(nextType);
	}
	if (gigSyncFields.length) {
		await db.query(`UPDATE gig g INNER JOIN event_gig eg ON eg.gig_id = g.id SET ${gigSyncFields.join(", ")} WHERE eg.event_id = ?`, [...gigSyncParams, resolvedId]);
	}

	const eventRows = await db.query(`SELECT date, city_id, venue_id, type FROM event WHERE id=?`, [resolvedId]);
	const existingGigRows = await db.query(
		`
		SELECT eg.gig_id, g.artist_id
		FROM event_gig eg
		INNER JOIN gig g ON g.id = eg.gig_id
		WHERE eg.event_id = ?
		`,
		[resolvedId]
	);
	const existingGigByArtist = new Map(existingGigRows.map((row) => [row.artist_id, row.gig_id]));
	const incomingSlots = normalizeArtistSlots(event.artists);
	const incomingGigUpdates = Array.isArray(event.gigs)
		? event.gigs.map((gig) => ({
			gig_id: normalizeNumber(gig.id),
			stage_id: normalizeNumber(gig.stage_id),
			stage_name: extractStageName(gig),
			start_time: normalizeTime(gig.start_time),
			end_time: normalizeTime(gig.end_time)
		}))
		: [];

	const stageLookup = await ensureEventStages(resolvedId, event.stages, [...incomingSlots, ...incomingGigUpdates]);
	let addedArtists = 0;
	let updatedEntries = 0;

	if (eventRows.length) {
		const eventData = eventRows[0];

		for (const slot of incomingSlots) {
			if (!slot.artist_id) {
				continue;
			}

			const stageId = resolveStageId(slot, stageLookup);
			const existingGigId = existingGigByArtist.get(slot.artist_id);

			if (existingGigId) {
				await db.query(`UPDATE event_gig SET stage_id=?, start_time=?, end_time=? WHERE event_id=? AND gig_id=?`, [stageId, slot.start_time, slot.end_time, resolvedId, existingGigId]);
				await db.query(`UPDATE gig SET start_time=?, end_time=? WHERE id=?`, [slot.start_time, slot.end_time, existingGigId]);
				updatedEntries++;
				continue;
			}

			const resultGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)`, [eventData.date, eventData.city_id, eventData.venue_id, slot.artist_id, eventData.type, slot.start_time, slot.end_time]);
			await db.query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)`, [resolvedId, resultGig.insertId, stageId, slot.start_time, slot.end_time]);
			existingGigByArtist.set(slot.artist_id, resultGig.insertId);
			addedArtists++;
		}
	}

	for (const gigUpdate of incomingGigUpdates) {
		if (!gigUpdate.gig_id) {
			continue;
		}

		const stageId = resolveStageId(gigUpdate, stageLookup);
		await db.query(`UPDATE event_gig SET stage_id=?, start_time=?, end_time=? WHERE event_id=? AND gig_id=?`, [stageId, gigUpdate.start_time, gigUpdate.end_time, resolvedId, gigUpdate.gig_id]);
		await db.query(`UPDATE gig SET start_time=?, end_time=? WHERE id=?`, [gigUpdate.start_time, gigUpdate.end_time, gigUpdate.gig_id]);
		updatedEntries++;
	}

	let message = "Error in updating Event";

	if (result.affectedRows || addedArtists || updatedEntries) {
		message = "Event updated successfully";
	}

	await syncEditionDatesForEditionIds(linkedEditionIds);

	return { message };
}

module.exports = {
	getMultiple,
	get,
	create,
	remove,
	update,
	dashboard
};
