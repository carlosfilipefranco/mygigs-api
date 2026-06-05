const db = require("./db");

function normalizeNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeIds(ids) {
	return [...new Set((ids || []).map(normalizeNumber).filter(Boolean))];
}

async function syncEditionDates(editionId, query = db.query) {
	const normalizedEditionId = normalizeNumber(editionId);
	if (!normalizedEditionId) {
		return null;
	}

	return query(
		`
		UPDATE edition
		SET
			date_start = (
				SELECT MIN(event.date)
				FROM edition_event
				INNER JOIN event ON event.id = edition_event.event_id
				WHERE edition_event.edition_id = ?
			),
			date_end = (
				SELECT MAX(event.date)
				FROM edition_event
				INNER JOIN event ON event.id = edition_event.event_id
				WHERE edition_event.edition_id = ?
			)
		WHERE id = ?
		`,
		[normalizedEditionId, normalizedEditionId, normalizedEditionId]
	);
}

async function syncEditionDatesForEditionIds(editionIds, query = db.query) {
	const ids = normalizeIds(editionIds);
	for (const editionId of ids) {
		await syncEditionDates(editionId, query);
	}
}

async function getEditionIdsForEvent(eventId, query = db.query) {
	const normalizedEventId = normalizeNumber(eventId);
	if (!normalizedEventId) {
		return [];
	}

	const rows = await query(`SELECT DISTINCT edition_id FROM edition_event WHERE event_id = ?`, [normalizedEventId]);
	return rows.map((row) => row.edition_id).filter(Boolean);
}

async function getEditionIdsForGig(gigId, query = db.query) {
	const normalizedGigId = normalizeNumber(gigId);
	if (!normalizedGigId) {
		return [];
	}

	const rows = await query(
		`
		SELECT DISTINCT edition_event.edition_id
		FROM event_gig
		INNER JOIN edition_event ON edition_event.event_id = event_gig.event_id
		WHERE event_gig.gig_id = ?
		`,
		[normalizedGigId]
	);
	return rows.map((row) => row.edition_id).filter(Boolean);
}

module.exports = {
	syncEditionDates,
	syncEditionDatesForEditionIds,
	getEditionIdsForEvent,
	getEditionIdsForGig
};
