const fetch = require("node-fetch");
const db = require("./db");
const config = require("../config");
const { buildUniqueSlug } = require("./slug");
const { syncEditionDates, getEditionIdsForEvent, syncEditionDatesForEditionIds } = require("./editionDates");

const API_KEY = process.env.SETLISTFM_API_KEY || config.setlistFm?.apiKey || "33b04241-2c2f-45e6-959a-ddf01429fc76";
const API_BASE_URL = "https://api.setlist.fm/rest/1.0";
const DEFAULT_COUNTRY_CODE = "PT";
const MAX_LIMIT = 200;
const MAX_RETRIES = 3;

function normalizeText(value) {
	return (value || "")
		.toString()
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEncore(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeLimit(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 50;
	}

	return Math.min(parsed, MAX_LIMIT);
}

function normalizeDate(value) {
	if (!value) {
		return null;
	}

	const str = normalizeText(value);
	const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (isoMatch) {
		return isValidDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) ? str : null;
	}

	const ptMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
	if (!ptMatch) {
		return null;
	}

	const day = Number(ptMatch[1]);
	const month = Number(ptMatch[2]);
	const year = Number(ptMatch[3]);
	if (!isValidDateParts(year, month, day)) {
		return null;
	}

	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDateParts(year, month, day) {
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		return false;
	}

	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseSetlistDate(value) {
	const match = normalizeText(value).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
	if (!match) {
		return null;
	}

	const day = Number(match[1]);
	const month = Number(match[2]);
	const year = Number(match[3]);
	if (!isValidDateParts(year, month, day)) {
		return null;
	}

	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toSetlistDate(value) {
	const iso = normalizeDate(value);
	if (!iso) {
		return null;
	}

	const [year, month, day] = iso.split("-");
	return `${day}-${month}-${year}`;
}

function stripAccents(value) {
	return (value || "")
		.toString()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
	return stripAccents(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

function isDateInRange(date, dateFrom, dateTo) {
	if (!date) {
		return false;
	}
	if (dateFrom && date < dateFrom) {
		return false;
	}
	if (dateTo && date > dateTo) {
		return false;
	}
	return true;
}

function getSearchYear(payload, dateFrom, dateTo) {
	const explicitYear = normalizeNumber(payload.year);
	if (explicitYear) {
		return explicitYear;
	}

	if (dateFrom && dateTo && dateFrom.slice(0, 4) === dateTo.slice(0, 4)) {
		return Number(dateFrom.slice(0, 4));
	}

	if (dateFrom && !dateTo) {
		return Number(dateFrom.slice(0, 4));
	}

	if (!dateFrom && dateTo) {
		return Number(dateTo.slice(0, 4));
	}

	return null;
}

function buildSearchParams(payload, page) {
	const params = new URLSearchParams();
	const dateFrom = normalizeDate(payload.date_from || payload.dateFrom);
	const dateTo = normalizeDate(payload.date_to || payload.dateTo);
	const exactDate = dateFrom && dateTo && dateFrom === dateTo ? toSetlistDate(dateFrom) : null;
	const year = getSearchYear(payload, dateFrom, dateTo);
	const artistName = normalizeText(payload.artist_name || payload.artistName);
	const venueName = normalizeText(payload.venue_name || payload.venueName);
	const venueId = normalizeText(payload.venue_id || payload.venueId);
	const cityName = normalizeText(payload.city_name || payload.cityName);
	const countryCode = normalizeText(payload.country_code || payload.countryCode || DEFAULT_COUNTRY_CODE).toUpperCase();

	if (!artistName && !venueName && !venueId && !cityName && !year && !exactDate) {
		throw new Error("Define pelo menos artista, venue, cidade, ano ou intervalo de datas.");
	}

	if (artistName) {
		params.append("artistName", artistName);
	}
	if (venueName) {
		params.append("venueName", venueName);
	}
	if (venueId) {
		params.append("venueId", venueId);
	}
	if (cityName) {
		params.append("cityName", cityName);
	}
	if (countryCode) {
		params.append("countryCode", countryCode);
	}
	if (exactDate) {
		params.append("date", exactDate);
	} else if (year) {
		params.append("year", `${year}`);
	}
	params.append("p", `${page}`);

	return { params, dateFrom, dateTo };
}

async function fetchSetlistFm(path, params) {
	const url = new URL(`${API_BASE_URL}${path}`);
	for (const [key, value] of params.entries()) {
		url.searchParams.append(key, value);
	}

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		const response = await fetch(url.toString(), {
			headers: {
				Accept: "application/json",
				"x-api-key": API_KEY,
				"User-Agent": "mygigs-app/1.0"
			}
		});

		if (response.status === 404) {
			return { setlist: [], total: 0, page: 1, itemsPerPage: 20 };
		}

		if (response.status === 429 && attempt < MAX_RETRIES) {
			const retryAfter = Number(response.headers.get("retry-after") || 1);
			await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 1) * 1000));
			continue;
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Erro na API setlist.fm: ${response.status} - ${text}`);
		}

		return response.json();
	}

	throw new Error("Erro na API setlist.fm: limite de pedidos atingido.");
}

function getTotalPages(data) {
	const explicitTotalPages = Number(data?.totalPages);
	if (Number.isFinite(explicitTotalPages) && explicitTotalPages > 0) {
		return explicitTotalPages;
	}

	const total = Number(data?.total);
	const itemsPerPage = Number(data?.itemsPerPage);
	if (Number.isFinite(total) && Number.isFinite(itemsPerPage) && itemsPerPage > 0) {
		return Math.max(Math.ceil(total / itemsPerPage), 1);
	}

	return 1;
}

function flattenSongs(setlist) {
	const songs = [];
	for (const set of setlist?.sets?.set || []) {
		const encore = normalizeEncore(set?.encore);
		for (const song of set?.song || []) {
			const name = normalizeText(song?.name);
			if (name) {
				songs.push({ name, encore });
			}
		}
	}
	return songs;
}

function mapSetlist(raw) {
	const date = parseSetlistDate(raw?.eventDate);
	const city = raw?.venue?.city || {};
	const coords = city?.coords || {};
	return {
		setlistfm_id: normalizeText(raw?.id),
		date,
		artist_name: normalizeText(raw?.artist?.name),
		artist_mbid: normalizeText(raw?.artist?.mbid),
		venue_name: normalizeText(raw?.venue?.name),
		setlistfm_venue_id: normalizeText(raw?.venue?.id),
		city_name: normalizeText(city?.name),
		state: normalizeText(city?.state),
		country_code: normalizeText(city?.country?.code),
		lat: coords?.lat || null,
		lng: coords?.long || null,
		url: normalizeText(raw?.url),
		songs: flattenSongs(raw),
		raw
	};
}

async function searchSetlists(payload = {}) {
	const limit = normalizeLimit(payload.limit);
	let page = 1;
	let totalPages = 1;
	const entries = [];
	const seen = new Set();
	let dateFrom = null;
	let dateTo = null;

	while (page <= totalPages && entries.length < limit) {
		const search = buildSearchParams(payload, page);
		dateFrom = search.dateFrom;
		dateTo = search.dateTo;
		const data = await fetchSetlistFm("/search/setlists", search.params);
		totalPages = getTotalPages(data);
		const setlists = Array.isArray(data.setlist) ? data.setlist : [];

		for (const raw of setlists) {
			const entry = mapSetlist(raw);
			if (!entry.setlistfm_id || !entry.date || !entry.artist_name || !entry.venue_name || !entry.city_name) {
				continue;
			}
			if (!isDateInRange(entry.date, dateFrom, dateTo)) {
				continue;
			}

			const key = entry.setlistfm_id || `${entry.date}:${normalizeKey(entry.artist_name)}:${normalizeKey(entry.venue_name)}:${normalizeKey(entry.city_name)}`;
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			entries.push(entry);
			if (entries.length >= limit) {
				break;
			}
		}

		page += 1;
	}

	return {
		entries,
		total_pages: totalPages,
		limited: entries.length >= limit,
		date_from: dateFrom,
		date_to: dateTo
	};
}

async function findArtist(name) {
	const rows = await db.query(`SELECT id, name, slug FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
	return rows[0] || null;
}

async function findCity(name) {
	const rows = await db.query(`SELECT id, name, state FROM city WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
	return rows[0] || null;
}

async function findVenue(name, cityId = null) {
	const rows = await db.query(
		`
		SELECT id, name, city_id
		FROM venue
		WHERE LOWER(name) = LOWER(?)
		  AND (? IS NULL OR city_id = ?)
		ORDER BY CASE WHEN city_id = ? THEN 0 ELSE 1 END, id ASC
		LIMIT 1
		`,
		[name, cityId, cityId, cityId]
	);
	return rows[0] || null;
}

async function findGig(artistId, venueId, date) {
	if (!artistId || !venueId || !date) {
		return null;
	}

	const rows = await db.query(`SELECT id FROM gig WHERE artist_id = ? AND venue_id = ? AND date = ? LIMIT 1`, [artistId, venueId, date]);
	return rows[0] || null;
}

async function enrichEntry(entry) {
	const artist = await findArtist(entry.artist_name);
	const city = await findCity(entry.city_name);
	const venue = await findVenue(entry.venue_name, city?.id || null);
	const gig = artist?.id && venue?.id ? await findGig(artist.id, venue.id, entry.date) : null;
	const setlistRows = gig?.id ? await db.query(`SELECT id FROM setlist WHERE gig_id = ? LIMIT 1`, [gig.id]) : [];

	return {
		...entry,
		artist_id: artist?.id || null,
		artist_exists: !!artist?.id,
		city_id: city?.id || null,
		city_exists: !!city?.id,
		venue_id: venue?.id || null,
		venue_exists: !!venue?.id,
		existing_gig_id: gig?.id || null,
		gig_exists: !!gig?.id,
		setlist_exists: !!setlistRows.length,
		action: gig?.id ? "existing_gig" : "create_gig"
	};
}

async function preview(payload = {}) {
	const search = await searchSetlists(payload);
	const entries = [];

	for (const entry of search.entries) {
		entries.push(await enrichEntry(entry));
	}

	const summary = entries.reduce(
		(acc, entry) => {
			acc.total += 1;
			if (!entry.artist_exists) acc.new_artists += 1;
			if (!entry.city_exists) acc.new_cities += 1;
			if (!entry.venue_exists) acc.new_venues += 1;
			if (entry.gig_exists) acc.existing_gigs += 1;
			if (!entry.gig_exists) acc.new_gigs += 1;
			if (entry.songs?.length) acc.with_setlists += 1;
			return acc;
		},
		{ total: 0, new_artists: 0, new_cities: 0, new_venues: 0, new_gigs: 0, existing_gigs: 0, with_setlists: 0 }
	);

	return {
		source: "setlist.fm",
		message: "Setlist.fm preview generated successfully",
		summary,
		entries,
		meta: {
			total_pages: search.total_pages,
			limited: search.limited,
			date_from: search.date_from,
			date_to: search.date_to
		}
	};
}

async function ensureArtist(entry, type, query = db.query) {
	const existing = await query(`SELECT id, name FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1`, [entry.artist_name]);
	if (existing.length) {
		return { id: existing[0].id, created: false };
	}

	const slug = await buildUniqueSlug({ query }, "artist", entry.artist_name);
	const result = await query(`INSERT INTO artist (name, image, mbid, type, slug) VALUES (?, '', ?, ?, ?)`, [entry.artist_name, entry.artist_mbid || "", type, slug]);
	return { id: result.insertId, created: true };
}

async function ensureCity(entry, query = db.query) {
	const existing = await query(`SELECT id, state FROM city WHERE LOWER(name) = LOWER(?) LIMIT 1`, [entry.city_name]);
	if (existing.length) {
		if (entry.state && !existing[0].state) {
			await query(`UPDATE city SET state = ? WHERE id = ?`, [entry.state, existing[0].id]);
		}
		return { id: existing[0].id, created: false };
	}

	const result = await query(`INSERT INTO city (name, state) VALUES (?, ?)`, [entry.city_name, entry.state || null]);
	return { id: result.insertId, created: true };
}

async function ensureVenue(entry, cityId, query = db.query) {
	const existing = await query(
		`
		SELECT id
		FROM venue
		WHERE LOWER(name) = LOWER(?) AND city_id = ?
		LIMIT 1
		`,
		[entry.venue_name, cityId]
	);
	if (existing.length) {
		return { id: existing[0].id, created: false };
	}

	const result = await query(`INSERT INTO venue (name, city_id, lat, lng) VALUES (?, ?, ?, ?)`, [entry.venue_name, cityId, entry.lat || null, entry.lng || null]);
	return { id: result.insertId, created: true };
}

async function ensureEditionEvent(editionId, entry, cityId, venueId, type, query = db.query) {
	const normalizedEditionId = normalizeNumber(editionId);
	if (!normalizedEditionId) {
		return null;
	}

	const existing = await query(
		`
		SELECT event.id
		FROM event
		INNER JOIN edition_event ON edition_event.event_id = event.id
		WHERE edition_event.edition_id = ? AND event.date = ?
		ORDER BY event.id ASC
		LIMIT 1
		`,
		[normalizedEditionId, entry.date]
	);
	if (existing.length) {
		return existing[0].id;
	}

	const editionRows = await query(`SELECT name FROM edition WHERE id = ? LIMIT 1`, [normalizedEditionId]);
	const eventName = `${editionRows?.[0]?.name || "Festival"} · ${entry.date}`;
	const slug = await buildUniqueSlug({ query }, "event", eventName);
	const eventResult = await query(`INSERT INTO event (name, slug, date, city_id, venue_id, type, description) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
		eventName,
		slug,
		entry.date,
		cityId,
		venueId,
		type,
		`Importado de setlist.fm: ${entry.url}`
	]);
	await query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [normalizedEditionId, eventResult.insertId]);
	return eventResult.insertId;
}

async function importSetlistSongs(entry, gigId, artistId, query = db.query) {
	if (!entry.songs?.length) {
		return { created: false, songs: 0 };
	}

	const existing = await query(`SELECT id FROM setlist WHERE gig_id = ? LIMIT 1`, [gigId]);
	if (existing.length) {
		return { created: false, songs: 0 };
	}

	const setlistResult = await query(`INSERT INTO setlist (gig_id, artist_id) VALUES (?, ?)`, [gigId, artistId]);
	let position = 1;
	let songs = 0;

	for (const song of entry.songs) {
		const songName = normalizeText(song.name);
		if (!songName) {
			continue;
		}

		await query(`INSERT IGNORE INTO song (name, artist_id) VALUES (?, ?)`, [songName, artistId]);
		const songRows = await query(`SELECT id FROM song WHERE name = ? AND artist_id = ? LIMIT 1`, [songName, artistId]);
		if (!songRows.length) {
			continue;
		}

		const encore = normalizeEncore(song.encore);
		await query(`INSERT INTO setlist_song (setlist_id, song_id, position, encore) VALUES (?, ?, ?, ?)`, [setlistResult.insertId, songRows[0].id, position, encore]);
		position += 1;
		songs += 1;
	}

	return { created: true, songs };
}

async function importEntries(payload = {}) {
	const selectedIds = new Set((payload.selected_ids || payload.selectedIds || []).map((id) => `${id}`));
	const importSetlists = payload.import_setlists === true || payload.importSetlists === true;
	const type = normalizeNumber(payload.type) || 1;
	const targetEditionId = normalizeNumber(payload.edition_id || payload.editionId);
	const targetEventId = normalizeNumber(payload.event_id || payload.eventId);

	if (targetEditionId && targetEventId) {
		throw new Error("Define apenas uma edição ou um evento, não ambos.");
	}

	const search = await searchSetlists(payload);
	const entries = search.entries.filter((entry) => !selectedIds.size || selectedIds.has(entry.setlistfm_id));

	const summary = {
		processed: 0,
		created_artists: 0,
		created_cities: 0,
		created_venues: 0,
		created_gigs: 0,
		existing_gigs: 0,
		linked_events: 0,
		created_setlists: 0,
		created_songs: 0,
		ignored: 0
	};
	const results = [];

	await db.transaction(async (query) => {
		const touchedEditionIds = new Set();

		for (const entry of entries) {
			summary.processed += 1;
			const artist = await ensureArtist(entry, type, query);
			const city = await ensureCity(entry, query);
			const venue = await ensureVenue(entry, city.id, query);
			if (artist.created) summary.created_artists += 1;
			if (city.created) summary.created_cities += 1;
			if (venue.created) summary.created_venues += 1;

			const existingGig = await query(`SELECT id FROM gig WHERE artist_id = ? AND venue_id = ? AND date = ? LIMIT 1`, [artist.id, venue.id, entry.date]);
			let gigId = existingGig?.[0]?.id || null;
			let action = "existing_gig";

			if (gigId) {
				summary.existing_gigs += 1;
			} else {
				const positionRows = await query(`SELECT COALESCE(MAX(position), 0) AS max_position FROM gig WHERE venue_id = ? AND date = ?`, [venue.id, entry.date]);
				const position = Number(positionRows?.[0]?.max_position || 0) + 1;
				const gigResult = await query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type, position) VALUES (?, ?, ?, ?, ?, ?)`, [entry.date, city.id, venue.id, artist.id, type, position]);
				gigId = gigResult.insertId;
				action = "created_gig";
				summary.created_gigs += 1;
			}

			let eventId = targetEventId || null;
			if (targetEditionId) {
				eventId = await ensureEditionEvent(targetEditionId, entry, city.id, venue.id, type, query);
				touchedEditionIds.add(targetEditionId);
			}

			if (eventId && gigId) {
				const eventGigRows = await query(`SELECT gig_id FROM event_gig WHERE event_id = ? AND gig_id = ? LIMIT 1`, [eventId, gigId]);
				if (!eventGigRows.length) {
					await query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, NULL, NULL, NULL)`, [eventId, gigId]);
					summary.linked_events += 1;
				}
				const linkedEditionIds = await getEditionIdsForEvent(eventId, query);
				for (const editionId of linkedEditionIds) {
					touchedEditionIds.add(editionId);
				}
			}

			if (importSetlists && gigId) {
				const setlistResult = await importSetlistSongs(entry, gigId, artist.id, query);
				if (setlistResult.created) {
					summary.created_setlists += 1;
					summary.created_songs += setlistResult.songs;
				}
			}

			results.push({
				setlistfm_id: entry.setlistfm_id,
				artist_name: entry.artist_name,
				date: entry.date,
				venue_name: entry.venue_name,
				gig_id: gigId,
				event_id: eventId,
				action
			});
		}

		for (const editionId of touchedEditionIds) {
			await syncEditionDates(editionId, query);
		}
		if (targetEventId) {
			const editionIds = await getEditionIdsForEvent(targetEventId, query);
			await syncEditionDatesForEditionIds(editionIds, query);
		}
	});

	return {
		message: "Setlist.fm import completed successfully",
		summary,
		results
	};
}

module.exports = {
	preview,
	importEntries
};
