const db = require("./db");

function fail(message, statusCode = 400) {
	throw Object.assign(new Error(message), { statusCode });
}

function isFestivalVenueName(name) {
	return /^(super\s+bock\s+super\s+rock|sbsr|(?:meo\s+)?kalorama)(?:\s+\d{4})?$/i.test(String(name || "").trim());
}

function assertPhysicalVenueName(name) {
	if (isFestivalVenueName(name)) fail(`«${String(name).trim()}» é um festival. Seleciona o recinto físico da edição.`);
}

async function ensureAlias(venueId, name, query = db.query) {
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (!trimmed || trimmed.length > 255) fail("Indica um nome de local com até 255 caracteres.");
	assertPhysicalVenueName(trimmed);
	const rows = await query(`SELECT id FROM venue_alias WHERE venue_id = ? AND name = ?`, [venueId, trimmed]);
	if (rows.length) return rows[0].id;
	const result = await query(`INSERT INTO venue_alias (venue_id, name) VALUES (?, ?)`, [venueId, trimmed]);
	return result.insertId;
}

async function resolveVenue(id, query = db.query, { lock = false } = {}) {
	const numericId = Number(id);
	if (!Number.isInteger(numericId) || numericId <= 0) fail("Local inválido.");
	const rows = await query(`SELECT v.* FROM venue v WHERE v.id = ?${lock ? " FOR UPDATE" : ""}`, [numericId]);
	if (rows.length) return { ...rows[0], alias_id: null };
	const redirects = await query(`SELECT venue_id, venue_alias_id FROM venue_redirect WHERE source_venue_id = ?`, [numericId]);
	if (!redirects.length) fail("Local não encontrado.", 404);
	const targets = await query(`SELECT * FROM venue WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [redirects[0].venue_id]);
	if (!targets.length) fail("Local não encontrado.", 404);
	return { ...targets[0], alias_id: redirects[0].venue_alias_id };
}

async function selectVenue(id, aliasId, query = db.query) {
	const venue = await resolveVenue(id, query, { lock: true });
	const chosenAlias = aliasId === undefined ? venue.alias_id : aliasId;
	if (chosenAlias !== null && chosenAlias !== undefined && chosenAlias !== "") {
		const numericAlias = Number(chosenAlias);
		if (!Number.isInteger(numericAlias) || numericAlias <= 0) fail("Nome histórico inválido.");
		const rows = await query(`SELECT id, name FROM venue_alias WHERE id = ? AND venue_id = ?`, [numericAlias, venue.id]);
		if (!rows.length) fail("O nome histórico não pertence a este local.");
		venue.alias_id = rows[0].id;
		venue.alias_name = rows[0].name;
	} else {
		venue.alias_id = null;
	}
	if (!venue.city_id || !(await query(`SELECT id FROM city WHERE id = ?`, [venue.city_id])).length) fail("Define a cidade do local antes de o associar a um concerto.");
	return venue;
}

async function findVenueByName(name, cityId, query = db.query) {
	// Uma correspondência de nome sem cidade pode apontar para espaços físicos diferentes.
	if (!name || !cityId) return null;
	const rows = await query(`SELECT v.id, v.name, v.city_id,
		(SELECT a.id FROM venue_alias a WHERE a.venue_id = v.id AND a.name = ? LIMIT 1) AS alias_id
		FROM venue v WHERE v.city_id = ? AND (v.name = ? OR EXISTS (SELECT 1 FROM venue_alias a WHERE a.venue_id = v.id AND a.name = ?))
		ORDER BY v.id LIMIT 2`, [name, cityId, name, name]);
	if (rows.length > 1) fail("Há vários locais com este nome na mesma cidade. Seleciona o local pelo ID.", 409);
	return rows[0] || null;
}

function selectedAlias(input) {
	if (Object.prototype.hasOwnProperty.call(input || {}, "venue_alias_id")) return input.venue_alias_id;
	if (input?.venue && typeof input.venue === "object" && Object.prototype.hasOwnProperty.call(input.venue, "alias_id")) return input.venue.alias_id;
	return undefined;
}

module.exports = { ensureAlias, resolveVenue, selectVenue, findVenueByName, selectedAlias, isFestivalVenueName, assertPhysicalVenueName };
