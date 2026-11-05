const { serviceKey } = require("./securityConfig");
const fetch = require("node-fetch");
const db = require("./db");

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
function positiveId(value) {
	if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, "Concerto inválido.");
	return Number(value);
}
function key(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase(); }

async function getSetlist(gigIdentifier, query = db.query) {
	const gigId = positiveId(gigIdentifier);
	const rows = await query(`SELECT song.name, ss.position, ss.encore FROM setlist s
		JOIN setlist_song ss ON ss.setlist_id = s.id JOIN song ON song.id = ss.song_id
		WHERE s.gig_id = ? ORDER BY ss.position`, [gigId]);
	if (!rows.length) return null;
	const sets = new Map();
	for (const row of rows) {
		const encore = Number(row.encore) || 0;
		if (!sets.has(encore)) sets.set(encore, { ...(encore ? { encore } : {}), song: [] });
		sets.get(encore).song.push({ name: row.name });
	}
	return { sets: { set: [...sets.values()] } };
}

async function fetchSetlist(gigIdentifier) {
	return fetchAndStoreSetlist(gigIdentifier, false);
}

async function refreshSetlist(gigIdentifier) {
	return fetchAndStoreSetlist(gigIdentifier, true);
}

async function fetchAndStoreSetlist(gigIdentifier, replaceExisting) {
	const gigId = positiveId(gigIdentifier);
	if (!replaceExisting) {
		const stored = await getSetlist(gigId);
		if (stored) return stored;
	}
	const rows = await db.query(`SELECT g.id, g.artist_id, g.venue_id, g.venue_alias_id, g.city_id, DATE_FORMAT(g.date, '%d-%m-%Y') AS date,
		a.name AS artist, a.mbid, COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id = g.venue_alias_id AND vn.venue_id = v.id), v.name) AS venue, c.name AS city
		FROM gig g JOIN artist a ON a.id = g.artist_id JOIN venue v ON v.id = g.venue_id
		JOIN city c ON c.id = g.city_id WHERE g.id = ? AND g.type = 1`, [gigId]);
	const gig = rows[0];
	if (!gig) fail(404, "Concerto não encontrado.");
	if (!gig.date) return null;
	const apiKey = serviceKey("SETLISTFM_API_KEY");
	if (!apiKey) fail(503, "A integração com o setlist.fm não está configurada.");
	const params = new URLSearchParams({ artistName: gig.artist, cityName: gig.city, venueName: gig.venue, date: gig.date });
	const response = await fetch(`https://api.setlist.fm/rest/1.0/search/setlists?${params}`, {
		headers: { Accept: "application/json", "x-api-key": apiKey }, timeout: 15000, size: 2 * 1024 * 1024
	});
	if (response.status === 404) return null;
	if (!response.ok) fail(502, "Não foi possível consultar o setlist.fm.");
	const data = await response.json();
	const matches = (Array.isArray(data.setlist) ? data.setlist : []).filter(entry => entry.eventDate === gig.date
		&& key(entry.artist?.name) === key(gig.artist) && key(entry.venue?.name) === key(gig.venue)
		&& key(entry.venue?.city?.name) === key(gig.city) && (!gig.mbid || entry.artist?.mbid === gig.mbid));
	if (matches.length !== 1) return null;
	const sets = matches[0].sets?.set;
	if (!Array.isArray(sets) || sets.some(set => !set || !Array.isArray(set.song))) return null;
	const songsToStore = sets.flatMap(set => {
		const encore = Number.isSafeInteger(Number(set.encore)) && Number(set.encore) > 0 ? Number(set.encore) : 0;
		return set.song.filter(song => typeof song?.name === "string" && song.name.trim())
			.map(song => ({ name: song.name.trim(), encore }));
	});
	if (!songsToStore.length) return null;
	return db.transaction(async query => {
		// Confirmar que o concerto não foi editado durante o pedido externo.
		const current = await query(`SELECT artist_id, venue_id, venue_alias_id, city_id, DATE_FORMAT(date, '%d-%m-%Y') AS date FROM gig WHERE id = ? FOR UPDATE`, [gigId]);
		if (!current.length || current[0].artist_id !== gig.artist_id || current[0].venue_id !== gig.venue_id || current[0].venue_alias_id !== gig.venue_alias_id || current[0].city_id !== gig.city_id || current[0].date !== gig.date) fail(409, "O concerto foi alterado. Tenta novamente.");
		const existing = await query(`SELECT id FROM setlist WHERE gig_id = ? LIMIT 1 FOR UPDATE`, [gigId]);
		if (existing.length && !replaceExisting) return getSetlist(gigId, query);
		if (existing.length) {
			await query(`DELETE FROM setlist_song WHERE setlist_id IN (SELECT id FROM setlist WHERE gig_id = ?)`, [gigId]);
			await query(`DELETE FROM setlist WHERE gig_id = ?`, [gigId]);
		}
		const result = await query(`INSERT INTO setlist (gig_id, artist_id) VALUES (?, ?)`, [gigId, gig.artist_id]);
		let position = 1;
		for (const { name, encore } of songsToStore) {
			await query(`INSERT IGNORE INTO song (name, artist_id) VALUES (?, ?)`, [name, gig.artist_id]);
			const songs = await query(`SELECT id FROM song WHERE name = ? AND artist_id = ? LIMIT 1`, [name, gig.artist_id]);
			if (!songs.length) fail(502, "Não foi possível guardar a setlist.");
			await query(`INSERT INTO setlist_song (setlist_id, song_id, position, encore) VALUES (?, ?, ?, ?)`, [result.insertId, songs[0].id, position++, encore]);
		}
		return getSetlist(gigId, query);
	}, { lockName: "setlistfm-import" });
}

module.exports = { getSetlist, fetchSetlist, refreshSetlist };
