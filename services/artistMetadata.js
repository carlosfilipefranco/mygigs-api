const db = require("./db");
const fetch = require("node-fetch");
const { load } = require("cheerio/slim");

const LANGUAGE = "pt";
const inFlight = new Map();

function sourceUrl(artist, value) {
	try {
		const url = new URL(value);
		if (["http:", "https:"].includes(url.protocol) && ["last.fm", "www.last.fm"].includes(url.hostname) && !url.username && !url.password && !url.port) {
			url.protocol = "https:";
			return url.href;
		}
	} catch {}
	return `https://www.last.fm/music/${encodeURIComponent(artist.name)}`;
}

function cleanBiography(value) {
	const $ = load(String(value || ""), null, false);
	$("script, style, a[href*='last.fm/music/']").remove();
	$("br").replaceWith("\n");
	$("p").append("\n\n");
	return $.root().text().replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
}

function normalizeTags(value) {
	const tags = typeof value === "string" ? JSON.parse(value) : value;
	return (Array.isArray(tags) ? tags : []).filter(tag => typeof tag?.name === "string" && tag.name.trim()).slice(0, 8).map(tag => ({ name: tag.name.trim().slice(0, 100) }));
}

async function read(artistId) {
	const rows = await db.query(`SELECT biography, tags, source_url,
		DATE_FORMAT(fetched_at, '%Y-%m-%dT%H:%i:%sZ') AS fetched_at,
		next_refresh_at <= UTC_TIMESTAMP() AS needs_refresh
		FROM artist_metadata WHERE artist_id = ? AND language = ?`, [artistId, LANGUAGE]);
	return rows[0] || null;
}

function metadata(artist, row) {
	return {
		language: LANGUAGE,
		content: row?.biography || null,
		tags: normalizeTags(row?.tags),
		source: "Last.fm",
		source_url: sourceUrl(artist, row?.source_url),
		fetched_at: row?.fetched_at || null,
		status: row?.fetched_at ? (row.biography ? "available" : "missing") : "unavailable"
	};
}

async function fetchInfo(artist, apiKey, language) {
	const params = new URLSearchParams({ method: "artist.getInfo", api_key: apiKey, format: "json", lang: language });
	const mbid = String(artist.mbid || "").trim();
	if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(mbid)) params.set("mbid", mbid);
	else params.set("artist", artist.name);

	async function request() {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 8000);
		try {
			const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { signal: controller.signal, size: 1024 * 1024, redirect: "error" });
			if (!response.ok) throw new Error("Last.fm indisponível.");
			return await response.json();
		} finally {
			clearTimeout(timer);
		}
	}

	let body = await request();
	if (Number(body.error) === 6 && params.has("mbid")) {
		params.delete("mbid");
		params.set("artist", artist.name);
		body = await request();
	}
	if (Number(body.error) === 6) return null;
	if (body.error || !body.artist || typeof body.artist !== "object") throw new Error("Não foi possível obter os dados do Last.fm.");
	return body.artist;
}

async function updateStored(artist, apiKey, force) {
	await db.query(`INSERT IGNORE INTO artist_metadata (artist_id, language, tags, source_url, next_refresh_at)
		VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`, [artist.id, LANGUAGE, "[]", sourceUrl(artist)]);
	// A reserva na BD evita pedidos duplicados entre diferentes processos da API.
	const claim = await db.query(`UPDATE artist_metadata SET refreshing_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)
		WHERE artist_id = ? AND language = ? AND (refreshing_until IS NULL OR refreshing_until <= UTC_TIMESTAMP())
		AND (? = 1 OR next_refresh_at <= UTC_TIMESTAMP())`, [artist.id, LANGUAGE, force ? 1 : 0]);
	if (!claim.affectedRows) {
		if (force) throw Object.assign(new Error("Já está a decorrer uma atualização. Tenta novamente dentro de instantes."), { statusCode: 409 });
		return metadata(artist, await read(artist.id));
	}

	try {
		const info = await fetchInfo(artist, apiKey, LANGUAGE);
		let biography = cleanBiography(info?.bio?.content || info?.bio?.summary);
		if (biography) {
			// O Last.fm pode devolver o texto inglês quando não existe tradução.
			const english = await fetchInfo(artist, apiKey, "en");
			if (biography.replace(/\s+/g, " ") === cleanBiography(english?.bio?.content || english?.bio?.summary).replace(/\s+/g, " ")) biography = "";
		}
		const days = biography ? 30 : 7;
		await db.query(`UPDATE artist_metadata SET biography = ?, tags = ?, source_url = ?, fetched_at = UTC_TIMESTAMP(),
			next_refresh_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), refreshing_until = NULL
			WHERE artist_id = ? AND language = ?`, [biography || null, JSON.stringify(normalizeTags(info?.tags?.tag)), sourceUrl(artist, info?.url), days, artist.id, LANGUAGE]);
		return metadata(artist, await read(artist.id));
	} catch (error) {
		// Preserva o conteúdo válido e persiste o intervalo antes da próxima tentativa.
		await db.query(`UPDATE artist_metadata SET next_refresh_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), refreshing_until = NULL
			WHERE artist_id = ? AND language = ?`, [artist.id, LANGUAGE]);
		throw Object.assign(new Error("Não foi possível atualizar a biografia. Os dados anteriores foram mantidos."), { statusCode: 502 });
	}
}

function refresh(artist, apiKey, force = false) {
	const key = `${artist.id}:${LANGUAGE}`;
	if (inFlight.has(key)) return inFlight.get(key);
	const promise = updateStored(artist, apiKey, force).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

async function get(artist, apiKey) {
	let row;
	try {
		row = await read(artist.id);
		if (row && !Number(row.needs_refresh)) return metadata(artist, row);
		if (row?.fetched_at) {
			refresh(artist, apiKey).catch(() => console.error(`Não foi possível atualizar os dados Last.fm do artista ${artist.id}.`));
			return metadata(artist, row);
		}
		return await refresh(artist, apiKey);
	} catch {
		console.error(`Não foi possível carregar os dados Last.fm do artista ${artist.id}.`);
		return metadata(artist, row);
	}
}

function legacyBody(artist, data) {
	return { artist: { name: artist.name, url: data.source_url, bio: { content: data.content || "" }, tags: { tag: data.tags } } };
}

module.exports = { get, refresh, legacyBody };
