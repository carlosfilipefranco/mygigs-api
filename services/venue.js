const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { validateCityId } = require("./venueCity");
const { ensureAlias, resolveVenue, findVenueByName } = require("./venueNames");

function fail(message, statusCode = 400) {
	throw Object.assign(new Error(message), { statusCode });
}

async function getMultiple(page = 1, search = null, cityId = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	const text = typeof search === "string" ? search.trim().toLowerCase() : "";
	const filters = [], params = [];
	if (text) {
		filters.push(`(LOWER(venue.name) LIKE ? OR LOWER(city.name) LIKE ? OR EXISTS (SELECT 1 FROM venue_alias a WHERE a.venue_id = venue.id AND LOWER(a.name) LIKE ?))`);
		params.push(`%${text}%`, `%${text}%`, `%${text}%`);
	}
	if (cityId) {
		if (!Number.isInteger(Number(cityId)) || Number(cityId) <= 0) fail("Cidade inválida.");
		filters.push("venue.city_id = ?");params.push(Number(cityId));
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
	const matches = text ? `(SELECT a.id FROM venue_alias a WHERE a.venue_id = venue.id AND LOWER(a.name) LIKE ? ORDER BY (LOWER(a.name) = ?) DESC, a.name LIMIT 1)` : "NULL";
	const rows = await db.query(`SELECT venue.id, venue.name, venue.city_id, city.name AS city, venue.lat, venue.lng, ${matches} AS alias_id
		FROM venue LEFT JOIN city ON city.id = venue.city_id ${where} ORDER BY venue.name, city.name, venue.id LIMIT ${offset},${config.listPerPage}`, text ? [`%${text}%`, text, ...params] : params);
	const ids = rows.map(row => row.id);
	const aliases = ids.length ? await db.query(`SELECT id, venue_id, name FROM venue_alias WHERE venue_id IN (${ids.map(() => "?").join(",")}) ORDER BY name`, ids) : [];
	for (const row of rows) {
		row.aliases = aliases.filter(alias => alias.venue_id === row.id && alias.name.toLowerCase() !== row.name.toLowerCase());
		const match = aliases.find(alias => alias.id === row.alias_id);
		if (match?.name.toLowerCase() === row.name.toLowerCase()) row.alias_id = null;
		row.alias_name = row.alias_id ? match?.name || null : null;
		row.display_name = `${row.alias_name || row.name} — ${row.city || "Cidade por definir"}${row.alias_name ? ` (${row.name})` : ""}`;
	}
	const totals = await db.query(`SELECT COUNT(*) AS count FROM venue LEFT JOIN city ON city.id = venue.city_id ${where}`, params);
	return { data: helper.emptyOrRows(rows), meta: { page, count: totals[0].count } };
}

async function get(id, { page = 1, scope = "all", type = 1, userId = null } = {}) {
	const requestedPage = Number(page);
	const gigType = Number(type);
	if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000) fail("Página inválida.");
	if (![1, 2].includes(gigType)) fail("Tipo de evento inválido.");
	if (!["all", "mine"].includes(scope)) fail("Filtro inválido.");
	if (scope === "mine" && !userId) fail("Inicia sessão para veres os concertos que marcaste como vistos.", 401);
	const resolved = await resolveVenue(id);
	const saved = `EXISTS (SELECT 1 FROM user_gig ug WHERE ug.gig_id = gig.id AND ug.user_id = ? AND ug.status = 'going')`;
	const attended = `(${saved} AND gig.date < CURDATE())`;
	const [venues, aliases, totals] = await Promise.all([
		db.query(`SELECT venue.id, venue.name, venue.lat, venue.lng, venue.city_id, city.name AS city
			FROM venue LEFT JOIN city ON city.id = venue.city_id WHERE venue.id = ?`, [resolved.id]),
		db.query(`SELECT id, name FROM venue_alias WHERE venue_id = ? ORDER BY name`, [resolved.id]),
		db.query(`SELECT COUNT(*) AS total_gigs, COALESCE(SUM(${attended}), 0) AS attended_gigs
			FROM gig WHERE gig.venue_id = ? AND gig.type = ?`, [userId, resolved.id, gigType])
	]);
	venues[0].aliases = aliases.filter(alias => alias.name.toLowerCase() !== venues[0].name.toLowerCase());
	const stats = { total_gigs: Number(totals[0].total_gigs), attended_gigs: Number(totals[0].attended_gigs) };
	const total = scope === "mine" ? stats.attended_gigs : stats.total_gigs;
	const pageSize = 20;
	const pages = Math.ceil(total / pageSize);
	const pageNumber = Math.min(requestedPage, Math.max(1, pages));
	const params = [userId, resolved.id, gigType];
	if (scope === "mine") params.push(userId);
	// Uma única relação com evento por concerto evita duplicações entre páginas.
	const gigs = await db.query(`SELECT gig.id, gig.date, event.id AS event_id, event.name AS event_name, event.slug AS event_slug,
		artist.name AS artist, artist.image, artist.id AS artist_id, artist.slug AS artist_slug,
		COALESCE(va.name, venue.name) AS venue, venue.name AS venue_current_name, city.name AS city,
		${saved} AS is_saved, (gig.date < CURDATE()) AS is_past
		FROM gig INNER JOIN artist ON gig.artist_id = artist.id INNER JOIN venue ON gig.venue_id = venue.id
		LEFT JOIN venue_alias va ON va.id = gig.venue_alias_id AND va.venue_id = venue.id
		INNER JOIN city ON gig.city_id = city.id
		LEFT JOIN event ON event.id = (SELECT MIN(eg.event_id) FROM event_gig eg WHERE eg.gig_id = gig.id)
		WHERE venue.id = ? AND gig.type = ?${scope === "mine" ? ` AND ${attended}` : ""}
		ORDER BY gig.date DESC, gig.id DESC LIMIT ${pageSize} OFFSET ${(pageNumber - 1) * pageSize}`, params);
	for (const gig of gigs) {
		gig.attended = !!(gig.is_saved && gig.is_past);
		gig.going = !!(gig.is_saved && !gig.is_past && gig.date);
		delete gig.is_saved;
		delete gig.is_past;
	}
	return { gigs, venue: venues[0], stats,
		meta: { page: pageNumber, page_size: pageSize, total, pages, has_more: pageNumber < pages, scope },
		canonical_id: resolved.id, redirected: Number(id) !== resolved.id };
}

async function addNames(venueId, cityId, names, query) {
	if (names === undefined) return;
	const list = typeof names === "string" ? names.split(/\r?\n/) : names;
	if (!Array.isArray(list) || list.length > 50) fail("Indica até 50 nomes alternativos.");
	for (const item of list) {
		const name = (typeof item === "string" ? item : item?.name)?.trim();
		if (!name) continue;
		const existing = await findVenueByName(name, cityId, query);
		if (existing && existing.id !== venueId) fail(`O nome «${name}» já pertence a outro local nesta cidade. Usa a associação de espaços.`, 409);
		await ensureAlias(venueId, name, query);
	}
}

async function create(venue) {
	return db.transaction(async query => {
		const cityId = await validateCityId(venue.city_id || venue.city, query);
		const name = venue.name?.trim();
		if (!name || name.length > 255) fail("Indica um nome de local com até 255 caracteres.");
		const existing = await findVenueByName(name, cityId, query);
		if (existing) return { id: existing.id, alias_id: existing.alias_id, message: "Este local já existe nesta cidade." };
		const result = await query(`INSERT INTO venue (name, city_id, lat, lng) VALUES (?, ?, ?, ?)`, [name, cityId, normalizeCoordinate(venue.lat), normalizeCoordinate(venue.lng)]);
		await addNames(result.insertId, cityId, venue.aliases, query);
		return { id: result.insertId, message: "Local criado." };
	}, { lockName: "venue-names" });
}

async function createBulk(venues) {
	for (const venue of venues) await create(venue);
	return { message: "Locais criados." };
}

function normalizeCoordinate(value) {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

async function update(id, venue) {
	return db.transaction(async query => {
		const current = await resolveVenue(id, query, { lock: true });
		const cityId = await validateCityId(venue.city_id || venue.city || current.city_id, query);
		const name = venue.name?.trim();
		if (!name || name.length > 255) fail("Indica um nome de local com até 255 caracteres.");
		const existing = await findVenueByName(name, cityId, query);
		if (existing && existing.id !== current.id) fail("Já existe outro local com esse nome nesta cidade. Usa a associação de espaços.", 409);
		if (current.name !== name) {
			const aliasId = await ensureAlias(current.id, current.name, query);
			for (const table of ["gig", "event", "edition"]) {
				await query(`UPDATE ${table} SET venue_alias_id = ? WHERE venue_id = ? AND venue_alias_id IS NULL`, [aliasId, current.id]);
			}
		}
		await query(`UPDATE venue SET name = ?, city_id = ?, lat = ?, lng = ? WHERE id = ?`, [name, cityId, normalizeCoordinate(venue.lat), normalizeCoordinate(venue.lng), current.id]);
		await addNames(current.id, cityId, venue.aliases, query);
		if (Number(current.city_id) !== cityId) {
			await query(`UPDATE gig SET city_id = ? WHERE venue_id = ?`, [cityId, current.id]);
			await query(`UPDATE event SET city_id = ? WHERE venue_id = ?`, [cityId, current.id]);
		}
		return { id: current.id, message: "Local atualizado." };
	}, { lockName: "venue-names" });
}

async function merge(sourceId, targetId, { apply = true, beforeApply } = {}) {
	return db.transaction(async query => {
		const source = await resolveVenue(sourceId, query, { lock: true });
		const target = await resolveVenue(targetId, query, { lock: true });
		if (source.id === target.id) return { id: target.id, message: "Os nomes já estão associados ao mesmo espaço." };
		if (!source.city_id || source.city_id !== target.city_id) fail("Só podes associar locais da mesma cidade.");
		const overlaps = await query(`SELECT s.id AS source_gig, t.id AS target_gig FROM gig s JOIN gig t ON t.artist_id = s.artist_id AND t.date = s.date WHERE s.venue_id = ? AND t.venue_id = ? LIMIT 1`, [source.id, target.id]);
		if (overlaps.length) fail(`Existem concertos potencialmente duplicados (${overlaps[0].source_gig} e ${overlaps[0].target_gig}). Resolve-os antes de associar os locais.`, 409);
		const aliases = await query(`SELECT * FROM venue_alias WHERE venue_id IN (?, ?) FOR UPDATE`, [source.id, target.id]);
		const redirects = await query(`SELECT * FROM venue_redirect WHERE venue_id IN (?, ?) FOR UPDATE`, [source.id, target.id]);
		const references = {};
		for (const table of ["gig", "event", "edition"]) references[table] = await query(`SELECT * FROM ${table} WHERE venue_id = ? FOR UPDATE`, [source.id]);
		if (!apply) return { source_id: source.id, source_name: source.name, id: target.id, name: target.name,
		counts: Object.fromEntries(Object.entries(references).map(([table, rows]) => [table, rows.length])) };
		if (beforeApply) await beforeApply({ source, target, aliases, redirects, references });
		// Cada nome conserva a sua referência quando dois grupos de nomes são associados.
		for (const alias of aliases.filter(row => row.venue_id === source.id)) {
			const targetAliasId = await ensureAlias(target.id, alias.name, query);
			for (const table of ["gig", "event", "edition", "venue_redirect"]) {
				await query(`UPDATE ${table} SET venue_alias_id = ? WHERE venue_alias_id = ?`, [targetAliasId, alias.id]);
			}
		}
		const sourceNameId = await ensureAlias(target.id, source.name, query);
		const counts = {};
		for (const table of ["gig", "event", "edition"]) {
			const result = await query(`UPDATE ${table} SET venue_id = ?, venue_alias_id = COALESCE(venue_alias_id, ?) WHERE venue_id = ?`, [target.id, sourceNameId, source.id]);
			counts[table] = result.affectedRows;
		}
		await query(`UPDATE venue_redirect SET venue_id = ? WHERE venue_id = ?`, [target.id, source.id]);
		await query(`INSERT INTO venue_redirect (source_venue_id, venue_id, venue_alias_id) VALUES (?, ?, ?)`, [source.id, target.id, sourceNameId]);
		await query(`UPDATE venue SET lat = COALESCE(lat, ?), lng = COALESCE(lng, ?) WHERE id = ?`, [source.lat, source.lng, target.id]);
		await query(`DELETE FROM venue WHERE id = ?`, [source.id]);
		return { id: target.id, source_id: source.id, counts, message: "Nomes associados ao mesmo espaço. O histórico foi preservado." };
	}, { lockName: "venue-names" });
}

async function remove(id) {
	// Um link antigo permite consultar o espaço, mas não apagá-lo por engano.
	const resolved = await resolveVenue(id);
	if (Number(id) !== resolved.id) fail("Abre a ficha principal para remover este espaço.");
	const result = await db.query(`DELETE FROM venue WHERE id = ?`, [resolved.id]);
	return { message: result.affectedRows ? "Local removido." : "Local não encontrado." };
}

module.exports = { getMultiple, get, create, createBulk, update, merge, remove };
