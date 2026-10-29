const db = require("./db");
const { selectVenue, selectedAlias } = require("./venueNames");
const helper = require("../helper");
const config = require("../config");
const { resolveEntityIdByIdentifier, buildUniqueSlug } = require("./slug");
const { syncEditionDates } = require("./editionDates");
const festivalProgram = require("./festivalProgram");

const PORTUGUESE_MONTHS = {
	janeiro: 1,
	fevereiro: 2,
	marco: 3,
	março: 3,
	abril: 4,
	maio: 5,
	junho: 6,
	julho: 7,
	agosto: 8,
	setembro: 9,
	outubro: 10,
	novembro: 11,
	dezembro: 12
};

const LOWERCASE_NAME_WORDS = new Set(["de", "da", "do", "dos", "das", "e", "a", "o", "os", "as", "com", "the", "of", "and", "in", "on"]);
const NON_ACRONYM_SHORT_WORDS = new Set(["THE", "AND", "FOR", "COM", "DOS", "DAS", "DE", "DA", "DO", "E", "A", "O", "OS", "AS", "OF", "IN", "ON", "TO"]);

function normalizeWhitespace(value) {
	return (value || "")
		.toString()
		.replace(/\r/g, "")
		.replace(/\u00A0/g, " ")
		.replace(/[ \t]+/g, " ")
		.trim();
}

function stripAccents(value) {
	return (value || "")
		.toString()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

function parseIsoDate(value) {
	if (!value) {
		return null;
	}

	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const year = value.getFullYear();
		const month = `${value.getMonth() + 1}`.padStart(2, "0");
		const day = `${value.getDate()}`.padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	const str = normalizeWhitespace(value);
	if (!str) {
		return null;
	}

	const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) {
		return null;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	if (!isValidDateParts(year, month, day)) {
		return null;
	}

	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferYearFromText(value) {
	const match = normalizeWhitespace(value).match(/\b((?:19|20)\d{2})\b/);
	if (!match) {
		return null;
	}

	const year = Number(match[1]);
	return Number.isFinite(year) ? year : null;
}

function isValidDateParts(year, month, day) {
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		return false;
	}

	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return false;
	}

	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function resolveDateForEdition(day, month, editionStartIso, editionEndIso, fallbackYear = null) {
	const years = [];
	if (editionStartIso) {
		years.push(Number(editionStartIso.slice(0, 4)));
	}
	if (editionEndIso) {
		years.push(Number(editionEndIso.slice(0, 4)));
	}
	if (fallbackYear) {
		years.push(Number(fallbackYear));
	}
	if (!years.length) {
		years.push(new Date().getFullYear());
	}

	const uniqueYears = [...new Set(years.filter((year) => Number.isFinite(year)))];
	const candidates = uniqueYears
		.map((year) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
		.filter((iso) => parseIsoDate(iso));

	if (editionStartIso && editionEndIso) {
		const inRange = candidates.find((candidate) => candidate >= editionStartIso && candidate <= editionEndIso);
		if (inRange) {
			return inRange;
		}
	}

	if (editionStartIso) {
		const startYear = Number(editionStartIso.slice(0, 4));
		const fallback = `${String(startYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
		if (parseIsoDate(fallback)) {
			return fallback;
		}
	}

	return candidates[0] || null;
}

function normalizeTimeValue(value) {
	const raw = normalizeWhitespace(value).toUpperCase();
	if (!raw) {
		return null;
	}

	let normalized = raw.replace(/\s+/g, "").replace(/\./g, ":").replace(/H/g, ":");
	normalized = normalized.replace(/:+/g, ":").replace(/^:/, "").replace(/:$/, "");

	let hours = null;
	let minutes = 0;

	const hm = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
	const hOnly = normalized.match(/^(\d{1,2})$/);
	const compact = normalized.match(/^(\d{3,4})$/);

	if (hm) {
		hours = Number(hm[1]);
		minutes = Number(hm[2]);
	} else if (hOnly) {
		hours = Number(hOnly[1]);
		minutes = 0;
	} else if (compact) {
		const chunk = compact[1];
		hours = Number(chunk.slice(0, chunk.length - 2));
		minutes = Number(chunk.slice(-2));
	} else {
		return null;
	}

	if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
		return null;
	}

	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function capitalizeWord(value) {
	if (!value) {
		return value;
	}

	const first = value.charAt(0).toLocaleUpperCase("pt-PT");
	const rest = value.slice(1).toLocaleLowerCase("pt-PT");
	return `${first}${rest}`;
}

function normalizeWordToken(token, index) {
	if (!token) {
		return token;
	}

	if (/^\d+$/.test(token)) {
		return token;
	}

	if (/[a-zà-ÿ]/.test(token) && /[A-ZÀ-Ý]/.test(token.slice(1))) {
		return token;
	}

	const onlyLetters = token.replace(/[^A-Za-zÀ-ÿ]/g, "");
	const hasSpecialAcronymChars = /[.&/+-]/.test(token);
	const isUpperToken = /^[A-ZÀ-Ý0-9.&/+-]+$/.test(token);
	const isAcronym = onlyLetters.length > 0 && onlyLetters.length <= 3 && isUpperToken && !NON_ACRONYM_SHORT_WORDS.has(token);
	const isDottedAcronym = token.includes(".") && /^[A-ZÀ-Ý0-9.]+$/.test(token);
	if (isAcronym || isDottedAcronym || (hasSpecialAcronymChars && isUpperToken)) {
		return token.toUpperCase();
	}

	const lowerToken = token.toLocaleLowerCase("pt-PT");
	if (index > 0 && LOWERCASE_NAME_WORDS.has(lowerToken)) {
		return lowerToken;
	}

	if (token.includes("-")) {
		return token
			.split("-")
			.map((piece, pieceIndex) => normalizeWordToken(piece, pieceIndex))
			.join("-");
	}

	if (token.includes("'")) {
		return token
			.split("'")
			.map((piece, pieceIndex) => normalizeWordToken(piece, pieceIndex))
			.join("'");
	}

	return capitalizeWord(lowerToken);
}

function normalizeTitleCase(value) {
	const clean = normalizeWhitespace(value);
	if (!clean) {
		return clean;
	}

	const words = clean.split(" ");
	return words.map((word, index) => normalizeWordToken(word, index)).join(" ");
}

function normalizeStageName(value) {
	return normalizeTitleCase(value).replace(/[:;]+$/g, "");
}

function normalizeArtistName(value) {
	return normalizeTitleCase(value);
}

function isLikelyStageHeader(line) {
	const normalized = stripAccents(normalizeStageName(line)).toLocaleLowerCase("pt-PT");
	return /^(palco|after[-\s]?hours|jazz na relva|coreto|tenda|auditorio|sala|stage)\b/.test(normalized);
}

function parseDateHeader(line) {
	const normalized = stripAccents(line)
		.toLocaleLowerCase("pt-PT")
		.replace(/\s*\([^)]*\)\s*$/g, "")
		.replace(/[:;]+$/g, "")
		.trim();
	const match = normalized.match(/^(?:dia\s+\d+\s*[-–—]\s*)?(?:dia\s+)?(\d{1,2})\s*(?:de\s+)?([a-z]+)$/i);
	if (!match) {
		return null;
	}

	const day = Number(match[1]);
	const monthName = match[2];
	const month = PORTUGUESE_MONTHS[monthName];
	if (!month || day < 1 || day > 31) {
		return null;
	}

	return { day, month };
}

function parseProgramSlotLine(line) {
	const explicitTimeMatch = line.match(/^(\d{1,2}\s*(?:[:hH.])\s*\d{0,2})\s*(?:(?:\||-|–|—|:)\s*)?(.+)$/);
	if (explicitTimeMatch) {
		return {
			rawTime: explicitTimeMatch[1],
			rawArtists: explicitTimeMatch[2]
		};
	}

	const separatedHourMatch = line.match(/^(\d{1,2})\s*(?:\||-|–|—)\s*(.+)$/);
	if (separatedHourMatch) {
		return {
			rawTime: separatedHourMatch[1],
			rawArtists: separatedHourMatch[2]
		};
	}

	return null;
}

function parseProgramArtistNames(rawArtists) {
	return normalizeWhitespace(rawArtists)
		.replace(/^[|:;,\-–—]\s*/, "")
		.split(/\s*[·•]\s*/g)
		.map((name) => normalizeArtistName(name))
		.filter(Boolean);
}

function parseProgramText(programText, editionStartIso, editionEndIso, fallbackYear = null) {
	const lines = (programText || "")
		.toString()
		.split("\n")
		.map((line) => normalizeWhitespace(line))
		.filter((line) => line.length > 0);

	const entries = [];
	const warnings = [];
	let currentDate = null;
	let invalidDateSection = false;
	let currentStage = null;
	let stagePosition = 0;
	let slotPosition = 0;
	const stagePositionByDate = new Map();

	const appendProgramSlot = (slot, line) => {
		const time = slot.rawTime ? normalizeTimeValue(slot.rawTime) : null;
		if (slot.rawTime && !time) {
			warnings.push(`Hora inválida ignorada: "${line}"`);
			return;
		}

		const artists = parseProgramArtistNames(slot.rawArtists);

		if (!artists.length) {
			warnings.push(`Artista inválido ignorado: "${line}"`);
			return;
		}

		for (const artist of artists) {
			const stageMap = stagePositionByDate.get(currentDate) || new Map();
			const normalizedStage = currentStage || "Sem palco";
			const mappedStagePosition = stageMap.get(normalizedStage) || 999;
			slotPosition += 1;
			entries.push({
				date: currentDate,
				stage_name: normalizedStage,
				stage_position: mappedStagePosition,
				position: slotPosition,
				start_time: time,
				end_time: null,
				artist_name: artist
			});
		}
	};

	for (const line of lines) {
		if (/^(?:(?:dia|data)\s+por\s+anunciar|sem\s+dia|a\s+anunciar)$/i.test(line)) {
			currentDate = null;
			invalidDateSection = false;
			currentStage = null;
			continue;
		}
		const dateHeader = parseDateHeader(line);
		if (dateHeader) {
			currentDate = resolveDateForEdition(dateHeader.day, dateHeader.month, editionStartIso, editionEndIso, fallbackYear);
			invalidDateSection = !currentDate;
			currentStage = null;
			stagePosition = 0;
			slotPosition = 0;
			if (!currentDate) {
				warnings.push(`Data inválida ignorada: "${line}"`);
			} else if (!stagePositionByDate.has(currentDate)) {
				stagePositionByDate.set(currentDate, new Map());
			}
			continue;
		}

		if (invalidDateSection) {
			warnings.push(`Linha ignorada após data inválida: "${line}"`);
			continue;
		}
		if (!currentDate && !isLikelyStageHeader(line)) {
			appendProgramSlot(parseProgramSlotLine(line) || { rawTime: null, rawArtists: line }, line);
			continue;
		}

		const slot = parseProgramSlotLine(line);
		if (slot) {
			appendProgramSlot(slot, line);
			continue;
		}

		if (!isLikelyStageHeader(line)) {
			appendProgramSlot({ rawTime: null, rawArtists: line }, line);
			continue;
		}

		stagePosition += 1;
		const normalizedStage = normalizeStageName(line);
		currentStage = normalizedStage || line;

		const stageMap = stagePositionByDate.get(currentDate) || new Map();
		if (!stageMap.has(currentStage)) {
			stageMap.set(currentStage, stagePosition);
			stagePositionByDate.set(currentDate, stageMap);
		}
	}

	return { entries, warnings };
}

function getImportActionLabel(action) {
	const labels = {
		create_artist_and_gig: "Criar artista e concerto",
		create_gig: "Criar concerto",
		update_gig: "Atualizar concerto",
		ignore_duplicate: "Ignorar duplicado"
	};

	return labels[action] || action;
}

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(edition.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT id, name, slug FROM edition ${searchQuery}  LIMIT ${offset},${config.listPerPage}`);
	const data = helper.emptyOrRows(rows);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM edition`);
		count = row[0].count;
	}

	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function get(id, userId = null) {
	try {
		const resolvedId = await resolveEntityIdByIdentifier(db, "edition", id);
		if (!resolvedId) {
			return {
				edition: null,
				gigs: []
			};
		}

		const edition = await db.query(
			`
		  SELECT e.id, e.slug, DATE_FORMAT(e.date_start, '%Y-%m-%d') AS date_start, DATE_FORMAT(e.date_end, '%Y-%m-%d') AS date_end, e.dates_confirmed, e.name AS name, e.image, COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id=e.venue_alias_id AND vn.venue_id=v.id), v.name) AS venue, e.venue_alias_id, c.name AS city, c.id AS city_id, v.id AS venue_id, festival.image as festival_image
		  FROM edition e
		  LEFT JOIN venue v ON e.venue_id = v.id
		  LEFT JOIN city c ON e.city_id = c.id
      LEFT JOIN festival ON e.festival_id = festival.id
		  WHERE e.id = ?
		`,
			[resolvedId]
		);

		if (!edition.length) {
			return {
				edition: null,
				gigs: []
			};
		}

		const userGigSelect = userId ? ", ug.status AS user_gig_status, ug.favorite AS user_gig_favorite" : "";
		const userGigJoin = userId ? "LEFT JOIN user_gig ug ON ug.gig_id = g.id AND ug.user_id = ?" : "";
		const gigsParams = userId ? [userId, resolvedId] : [resolvedId];
		const gigsRows = await db.query(
			`
		  SELECT g.id, g.date, g.artist_id, a.name AS artist, a.slug AS artist_slug, a.image, COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id=g.venue_alias_id AND vn.venue_id=v.id), v.name) AS venue, v.id AS venue_id, c.name AS city, c.id AS city_id,
		         ev.id AS event_id, ev.name AS event_name, ev.slug AS event_slug,
		         eg.stage_id, es.name AS stage_name,
		         COALESCE(eg.start_time, g.start_time) AS start_time,
		         COALESCE(eg.end_time, g.end_time) AS end_time
		         ${userGigSelect}
		  FROM gig g
		  INNER JOIN artist a ON g.artist_id = a.id
		  INNER JOIN venue v ON g.venue_id = v.id
		  INNER JOIN city c ON g.city_id = c.id
		  INNER JOIN event_gig eg ON g.id = eg.gig_id
		  INNER JOIN event ev ON eg.event_id = ev.id
		  INNER JOIN edition_event ee ON ev.id = ee.event_id
		  LEFT JOIN event_stage es ON es.id = eg.stage_id
		  ${userGigJoin}
		  WHERE ee.edition_id = ?
		  ORDER BY g.date ASC,
		           CASE WHEN COALESCE(eg.start_time, g.start_time) IS NULL THEN 1 ELSE 0 END,
		           CASE
		             WHEN COALESCE(eg.start_time, g.start_time) < '12:00:00'
		             THEN TIME_TO_SEC(COALESCE(eg.start_time, g.start_time)) + 86400
		             ELSE TIME_TO_SEC(COALESCE(eg.start_time, g.start_time))
		           END ASC,
		           es.position ASC,
		           g.position ASC,
		           a.name ASC
		`,
			gigsParams
		);

		const gigs = gigsRows.map((row) => ({
			id: row.id,
			date: row.date,
			edition_date_start: edition[0].date_start,
			edition_date_end: edition[0].date_end,
			artist_id: row.artist_id,
			artist: row.artist,
			artist_slug: row.artist_slug,
			image: row.image,
			venue: row.venue,
			venue_id: row.venue_id,
			city: row.city,
			city_id: row.city_id,
			event_id: row.event_id,
			event_name: row.event_name,
			event_slug: row.event_slug,
			stage_id: row.stage_id,
			stage_name: row.stage_name,
			start_time: row.start_time,
			end_time: row.end_time,
			user_gig: {
				status: row.user_gig_status || "not_going",
				favorite: !!row.user_gig_favorite
			}
		}));

		return {
			edition: {
				id: edition[0].id,
				slug: edition[0].slug || null,
				date_start: edition[0].date_start,
				date_end: edition[0].date_end,
				dates_confirmed: !!edition[0].dates_confirmed,
				name: edition[0].name,
				image: edition[0].image ? edition[0].image : edition[0].festival_image,
				venue: { id: edition[0].venue_id, name: edition[0].venue, alias_id: edition[0].venue_alias_id },
				city: { id: edition[0].city_id, name: edition[0].city }
			},
			gigs: gigs
		};
	} catch (error) {
		console.error("Ocorreu um erro ao obter os gigs por edition:", error);
		throw error;
	}
}

function officialDates(input, current = {}) {
	if (!Object.hasOwn(input, "date_start") && !Object.hasOwn(input, "date_end")) return {
		start: parseIsoDate(current.date_start), end: parseIsoDate(current.date_end), confirmed: Number(current.dates_confirmed) || 0
	};
	const start = festivalProgram.normalizeDate(input.date_start);
	const end = festivalProgram.normalizeDate(input.date_end) || start;
	if ((!start && end) || (start && end < start)) throw Object.assign(new Error("Indica um intervalo válido para as datas oficiais do festival."), { statusCode: 400 });
	return { start, end, confirmed: start ? 1 : 0 };
}

async function create(edition) {
	return db.transaction(async query => {
		const venue = await selectVenue(edition.venue?.id, selectedAlias(edition), query);
		const rows = await query(`SELECT id, date_start, date_end, dates_confirmed FROM edition WHERE name = ? FOR UPDATE`, [edition.name]);
		const dates = officialDates(edition, rows[0]);
		const slug = await buildUniqueSlug({ query }, "edition", edition.name, rows[0]?.id || null);
		let id = rows[0]?.id;
		if (id) {
			await query(`UPDATE edition SET name=?, slug=?, festival_id=?, image=?, city_id=?, venue_id=?, venue_alias_id=?, date_start=?, date_end=?, dates_confirmed=? WHERE id=?`, [edition.name, slug, edition.festival_id, edition.image || null, venue.city_id, venue.id, venue.alias_id, dates.start, dates.end, dates.confirmed, id]);
		} else {
			const result = await query(`INSERT INTO edition (name, slug, festival_id, image, city_id, venue_id, venue_alias_id, date_start, date_end, dates_confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [edition.name, slug, edition.festival_id, edition.image || null, venue.city_id, venue.id, venue.alias_id, dates.start, dates.end, dates.confirmed]);
			id = result.insertId;
		}
		await syncEditionDates(id, query);
		return { id, message: "Edition created successfully" };
	});
}

async function createBulk(editions) {
	editions.forEach(async (edition) => {
		const rows = await db.query(`SELECT id FROM edition WHERE name="${edition}"`);
		var result;
		const slug = await buildUniqueSlug(db, "edition", edition, rows?.[0]?.id || null);

		if (rows.length) {
			const id = rows[0].id;
			result = await db.query(`UPDATE edition SET name="${edition}", slug="${slug}" WHERE id=${id}`);
		} else {
			result = await db.query(`INSERT INTO edition (name, slug)  VALUES  ("${edition}", "${slug}")`);
		}
	});

	let message = "Editions created successfully";

	return { message };
}

async function update(id, edition) {
	return db.transaction(async query => {
		const resolvedId = await resolveEntityIdByIdentifier({ query }, "edition", id);
		const rows = await query(`SELECT venue_id, venue_alias_id, date_start, date_end, dates_confirmed FROM edition WHERE id = ? FOR UPDATE`, [resolvedId]);
		if (!rows.length) throw Object.assign(new Error("Edição não encontrada."), { statusCode: 404 });
		const dates = officialDates(edition, rows[0]);
		if (dates.confirmed) {
			const conflicts = await query(`SELECT g.id FROM gig g INNER JOIN event_gig eg ON eg.gig_id = g.id INNER JOIN edition_event ee ON ee.event_id = eg.event_id WHERE ee.edition_id = ? AND (g.date < ? OR g.date > ?) LIMIT 1`, [resolvedId, dates.start, dates.end]);
			if (conflicts.length) throw Object.assign(new Error("Há concertos fora deste intervalo. Corrige os dias antes de alterar as datas oficiais."), { statusCode: 409 });
		}
		const inputVenueId = Number(edition.venue?.id || rows[0].venue_id);
		const requestedAlias = selectedAlias(edition);
		const aliasId = requestedAlias === undefined && inputVenueId === rows[0].venue_id ? rows[0].venue_alias_id : requestedAlias;
		const venue = await selectVenue(inputVenueId, aliasId, query);
		const slug = await buildUniqueSlug({ query }, "edition", edition.name, resolvedId);
		await query(`UPDATE edition SET name=?, slug=?, image=?, city_id=?, venue_id=?, venue_alias_id=?, date_start=?, date_end=?, dates_confirmed=? WHERE id=?`, [edition.name, slug, edition.image || null, venue.city_id, venue.id, venue.alias_id, dates.start, dates.end, dates.confirmed, resolvedId]);
		await syncEditionDates(resolvedId, query);
		return { message: "Edition updated successfully" };
	});
}

async function remove(id) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "edition", id);
	if (!resolvedId) {
		return { message: "Edition not found" };
	}

	const result = await db.query(`DELETE FROM edition WHERE id=${resolvedId}`);

	let message = "Error in deleting Edition";

	if (result.affectedRows) {
		message = "Edition deleted successfully";
	}

	return { message };
}

async function parsedProgram(editionIdentifier, payload) {
	const id = await resolveEntityIdByIdentifier(db, "edition", editionIdentifier);
	const edition = await festivalProgram.loadEdition(id, db.query);
	const parsed = parseProgramText(payload.program, edition.date_start, edition.date_end, inferYearFromText(edition.name));
	if (parsed.entries.length > 1000) throw Object.assign(new Error("Importa até 1000 concertos de cada vez."), { statusCode: 400 });
	for (const entry of parsed.entries) festivalProgram.validateEditionDate(edition, entry.date);
	return { edition, ...parsed };
}

async function previewProgram(editionId, payload = {}) {
	const { edition, entries, warnings } = await parsedProgram(editionId, payload);
	const summary = { total_lines: entries.length, create_artist_and_gig: 0, create_gig: 0, update_gig: 0, ignore_duplicate: 0, warnings: warnings.length };
	const preview = [];
	const processed = new Set();
	for (const entry of entries) {
		const artists = await db.query(`SELECT id FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1`, [entry.artist_name]);
		const artistId = artists[0]?.id || null;
		const existing = artistId ? await festivalProgram.findFestivalGig(db.query, edition.id, artistId, entry.date, Number(payload.type) || 1) : null;
		const key = `${artistId || entry.artist_name.toLowerCase()}:${entry.date || "undated"}`;
		let action = artistId ? "create_gig" : "create_artist_and_gig";
		let note = "";
		if (processed.has(key) || (existing?.date && !entry.date)) {
			action = "ignore_duplicate";
			note = "Já existe; o dia confirmado será preservado.";
		} else if (existing) {
			const changed = existing.date !== entry.date || existing.start_time !== entry.start_time || existing.end_time !== entry.end_time || (existing.stage_name || "Sem palco") !== entry.stage_name || Number(existing.position) !== entry.position || Number(existing.stage_position) !== entry.stage_position;
			action = changed ? "update_gig" : "ignore_duplicate";
			note = existing.date !== entry.date ? "Atribuir o dia ao concerto existente, mantendo as marcações." : changed ? "Atualizar palco, horário ou ordem." : "Já existe sem alterações.";
		}
		processed.add(key);
		summary[action]++;
		preview.push({ ...entry, artist_id: artistId, existing_gig_id: existing?.id || null, action, action_label: getImportActionLabel(action), note });
	}
	return { summary, entries: preview, warnings };
}

async function importProgram(editionId, payload = {}) {
	const { edition, entries, warnings } = await parsedProgram(editionId, payload);
	if (!entries.length) return { created_artists: 0, created_events: 0, created_gigs: 0, updated_gigs: 0, ignored_duplicates: 0, warnings };
	const seen = new Set();
	const slots = entries.filter(entry => {
		const key = `${entry.artist_name.toLowerCase()}:${entry.date || "undated"}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const result = await festivalProgram.saveProgram(edition.id, slots, Number(payload.type) || 1);
	return { ...result, ignored_duplicates: result.ignored_duplicates + entries.length - slots.length, warnings };
}

module.exports = {
	getMultiple,
	create,
	update,
	remove,
	get,
	createBulk,
	previewProgram,
	importProgram
};
