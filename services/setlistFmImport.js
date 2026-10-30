const { serviceKey } = require("./securityConfig");
const fetch = require("node-fetch");
const db = require("./db");
const { findVenueByName, selectVenue, assertPhysicalVenueName } = require("./venueNames");
const { buildUniqueSlug } = require("./slug");
const { syncEditionDates, getEditionIdsForEvent, syncEditionDatesForEditionIds } = require("./editionDates");
const { ensureGigEvent } = require("./gigEvents");
const { normalizeCityName, normalizeCityState } = require("./city");


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

async function fetchSetlistFm(path, params = new URLSearchParams()) {
	const apiKey = serviceKey("SETLISTFM_API_KEY");
	if (!apiKey) throw Object.assign(new Error("A integração com o setlist.fm não está configurada."), { statusCode: 503 });
	const url = new URL(`${API_BASE_URL}${path}`);
	for (const [key, value] of params.entries()) {
		url.searchParams.append(key, value);
	}

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		const response = await fetch(url.toString(), {
			timeout: 15000,
			headers: {
				Accept: "application/json",
				"x-api-key": apiKey,
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
		country_name: normalizeText(city?.country?.name),
		city_source_id: city?.id != null ? String(city.id) : null,
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

async function findCity(name, countryCode = null, state = null, sourceId = null) {
	return require('./city').findCity({ name, country_code: countryCode, state, source:'setlistfm', source_id:sourceId });
}

async function findVenue(name, cityId = null) {
	return findVenueByName(name, cityId);
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
	const city = await findCity(entry.city_name, entry.country_code, entry.state, entry.city_source_id);
	const venue = city?.id ? await findVenue(entry.venue_name, city.id) : null;
	const gig = artist?.id && venue?.id ? await findGig(artist.id, venue.id, entry.date) : null;
	const setlistRows = gig?.id ? await db.query(`SELECT id FROM setlist WHERE gig_id = ? LIMIT 1`, [gig.id]) : [];
	const eventRows = gig?.id ? await db.query(`SELECT event_id FROM event_gig WHERE gig_id = ? ORDER BY event_id LIMIT 1`, [gig.id]) : [];

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
		existing_event_id: eventRows[0]?.event_id || null,
		event_exists: !!eventRows.length,
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

// Pesquisa paginada para o formulário público: um único pedido à fonte por página.
async function searchConcerts(payload = {}) {
	const invalid = () => Object.assign(new Error("Indica um artista e filtros de pesquisa válidos."), { statusCode: 400 });
	if (!payload || typeof payload.artist_name !== "string" || !payload.artist_name.trim() || payload.artist_name.length > 200) throw invalid();
	const page = Number(payload.page ?? 1);
	if (!Number.isInteger(page) || page < 1 || page > 1000) throw invalid();
	for (const field of ["city_name", "country_code", "date_from", "date_to"]) {
		if (payload[field] != null && (typeof payload[field] !== "string" || payload[field].length > 200)) throw invalid();
	}
	if (payload.country_code && !/^[a-z]{2}$/i.test(payload.country_code)) throw invalid();
	if (payload.year != null && (!Number.isInteger(Number(payload.year)) || Number(payload.year) < 1000 || Number(payload.year) > 9999)) throw invalid();
	if ((payload.date_from && !normalizeDate(payload.date_from)) || (payload.date_to && !normalizeDate(payload.date_to))) throw invalid();
	const filters = {
		artist_name: payload.artist_name, city_name: payload.city_name,
		country_code: payload.country_code, year: payload.year,
		date_from: payload.date_from, date_to: payload.date_to
	};
	const search = buildSearchParams(filters, page);
	const data = await fetchSetlistFm("/search/setlists", search.params);
	const entries = [];
	for (const raw of Array.isArray(data.setlist) ? data.setlist : []) {
		const entry = mapSetlist(raw);
		if (!entry.setlistfm_id || !entry.date || !entry.artist_name || !entry.venue_name || !entry.city_name) continue;
		if (!isDateInRange(entry.date, search.dateFrom, search.dateTo)) continue;
		const enriched = await enrichEntry(entry);
		// Não expor o objeto bruto nem as músicas na listagem.
		const { raw: source, songs, ...concert } = enriched;
		entries.push(concert);
	}
	return { entries, page, has_more: page < getTotalPages(data) };
}

async function importConcert(setlistId) {
	if (typeof setlistId !== "string" || !/^[a-f0-9]{8}$/i.test(setlistId)) {
		throw Object.assign(new Error("Identificador do setlist.fm inválido."), { statusCode: 400 });
	}
	// Nunca confiar nos dados enviados pelo browser para a criação automática.
	const raw = await fetchSetlistFm(`/setlist/${setlistId}`);
	const entry = mapSetlist(raw);
	if (entry.setlistfm_id.toLowerCase() !== setlistId.toLowerCase() || !entry.date || !entry.artist_name || !entry.venue_name || !entry.city_name) {
		throw Object.assign(new Error("Concerto não encontrado ou incompleto no setlist.fm."), { statusCode: 404 });
	}
	const result = await persistEntries([entry], { type: 1, import_setlists: true });
	return {
		message: result.summary.created_gigs ? "Concerto adicionado a partir do setlist.fm." : "Este concerto já existe.",
		data: result.results[0]
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
	return require('./city').ensureCity({ name: entry.city_name, state: entry.state, country_code: entry.country_code, country_name: entry.country_name,
		source: 'setlistfm', source_id: entry.city_source_id }, query, true);
}

async function ensureVenue(entry, cityId, query = db.query) {
	assertPhysicalVenueName(entry.venue_name);
	const existing = await findVenueByName(entry.venue_name, cityId, query);
	if (existing) {
		const venue = await selectVenue(existing.id, existing.alias_id, query);
		return { id: venue.id, alias_id: venue.alias_id, city_id: venue.city_id, created: false };
	}
	const result = await query(`INSERT INTO venue (name, city_id, lat, lng) VALUES (?, ?, ?, ?)`, [entry.venue_name, cityId, entry.lat || null, entry.lng || null]);
	return { id: result.insertId, alias_id: null, city_id: cityId, created: true };
}

async function ensureEditionEvent(editionId, entry, cityId, venueId, type, query = db.query, aliasId = null) {
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
		return { id: existing[0].id, created: false };
	}

	const editionRows = await query(`SELECT name FROM edition WHERE id = ? LIMIT 1`, [normalizedEditionId]);
	const eventName = `${editionRows?.[0]?.name || "Festival"} · ${entry.date}`;
	const slug = await buildUniqueSlug({ query }, "event", eventName);
	const eventResult = await query(`INSERT INTO event (name, slug, date, city_id, venue_id, type, description, venue_alias_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
		eventName,
		slug,
		entry.date,
		cityId,
		venueId,
		type,
		`Importado de setlist.fm: ${entry.url}`,
		aliasId
	]);
	await query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [normalizedEditionId, eventResult.insertId]);
	return { id: eventResult.insertId, created: true };
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
	const search = await searchSetlists(payload);
	const entries = search.entries.filter((entry) => !selectedIds.size || selectedIds.has(entry.setlistfm_id));
	return persistEntries(entries, payload);
}

async function persistEntries(entries, payload) {
	const importSetlists = payload.import_setlists === true || payload.importSetlists === true;
	const type = normalizeNumber(payload.type) || 1;
	const targetEditionId = normalizeNumber(payload.edition_id || payload.editionId);
	const targetEventId = normalizeNumber(payload.event_id || payload.eventId);

	if (targetEditionId && targetEventId) {
		throw new Error("Define apenas uma edição ou um evento, não ambos.");
	}

	const summary = {
		processed: 0,
		created_artists: 0,
		created_cities: 0,
		created_venues: 0,
		created_gigs: 0,
		existing_gigs: 0,
		linked_events: 0,
		created_events: 0,
		created_setlists: 0,
		created_songs: 0,
		ignored: 0
	};
	const results = [];

	await db.transaction(async (query) => {
		const touchedEditionIds = new Set();
		const prepared = [];
		if (targetEventId) {
			const targets = await query(`SELECT id FROM event WHERE id = ?`, [targetEventId]);
			if (!targets.length) throw new Error("Evento de destino não encontrado.");
		}
		if (targetEditionId) {
			const targets = await query(`SELECT id FROM edition WHERE id = ?`, [targetEditionId]);
			if (!targets.length) throw new Error("Edição de destino não encontrada.");
		}

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
				const gigResult = await query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type, position, venue_alias_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [entry.date, venue.city_id, venue.id, artist.id, type, position, venue.alias_id]);
				gigId = gigResult.insertId;
				action = "created_gig";
				summary.created_gigs += 1;
			}

			prepared.push({ entry, gigId, artistId: artist.id, cityId: venue.city_id, venueId: venue.id, aliasId: venue.alias_id, action });
		}

		// Preparar primeiro todos os concertos permite nomear um evento com os vários artistas.
		for (const { entry, gigId, artistId, cityId, venueId, aliasId, action } of prepared) {
			let eventId = targetEventId || null;
			if (targetEditionId) {
				const event = await ensureEditionEvent(targetEditionId, entry, cityId, venueId, type, query, aliasId);
				eventId = event.id;
				if (event.created) summary.created_events++;
				touchedEditionIds.add(targetEditionId);
			} else if (!targetEventId) {
				const event = await ensureGigEvent(gigId, query, { sourceUrl: entry.url });
				eventId = event.event_id;
				if (event.created) summary.created_events++;
				if (event.linked) summary.linked_events++;
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
				const setlistResult = await importSetlistSongs(entry, gigId, artistId, query);
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
	}, { lockName: "setlistfm-import" });

	return {
		message: "Setlist.fm import completed successfully",
		summary,
		results
	};
}

module.exports = {
	preview,
	importEntries,
	searchConcerts,
	importConcert
};
