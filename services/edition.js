const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { resolveEntityIdByIdentifier, buildUniqueSlug } = require("./slug");

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

function resolveDateForEdition(day, month, editionStartIso, editionEndIso) {
	const years = [];
	if (editionStartIso) {
		years.push(Number(editionStartIso.slice(0, 4)));
	}
	if (editionEndIso) {
		years.push(Number(editionEndIso.slice(0, 4)));
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
	return normalizeTitleCase(value);
}

function normalizeArtistName(value) {
	return normalizeTitleCase(value);
}

function parseDateHeader(line) {
	const normalized = stripAccents(line).toLocaleLowerCase("pt-PT");
	const match = normalized.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)$/i);
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
	const slotMatch = line.match(/^(\d{1,2}(?:\s*(?:[:hH.])\s*\d{0,2})?)\s*(?:(?:\||-|–|—)\s*)?(.+)$/);
	if (!slotMatch) {
		return null;
	}

	return {
		rawTime: slotMatch[1],
		rawArtists: slotMatch[2]
	};
}

function parseProgramText(programText, editionStartIso, editionEndIso) {
	const lines = (programText || "")
		.toString()
		.split("\n")
		.map((line) => normalizeWhitespace(line))
		.filter((line) => line.length > 0);

	const entries = [];
	const warnings = [];
	let currentDate = null;
	let currentStage = null;
	let stagePosition = 0;
	const stagePositionByDate = new Map();

	for (const line of lines) {
		const dateHeader = parseDateHeader(line);
		if (dateHeader) {
			currentDate = resolveDateForEdition(dateHeader.day, dateHeader.month, editionStartIso, editionEndIso);
			currentStage = null;
			stagePosition = 0;
			if (!currentDate) {
				warnings.push(`Data inválida ignorada: "${line}"`);
			} else if (!stagePositionByDate.has(currentDate)) {
				stagePositionByDate.set(currentDate, new Map());
			}
			continue;
		}

		if (!currentDate) {
			warnings.push(`Linha ignorada sem data: "${line}"`);
			continue;
		}

		const slot = parseProgramSlotLine(line);
		if (slot) {
			const time = normalizeTimeValue(slot.rawTime);
			if (!time) {
				warnings.push(`Hora inválida ignorada: "${line}"`);
				continue;
			}

			const artists = slot.rawArtists
				.split(/\s*[·•]\s*/g)
				.map((name) => normalizeArtistName(name))
				.filter(Boolean);

			if (!artists.length) {
				warnings.push(`Artista inválido ignorado: "${line}"`);
				continue;
			}

			for (const artist of artists) {
				const stageMap = stagePositionByDate.get(currentDate) || new Map();
				const normalizedStage = currentStage || "Sem palco";
				const mappedStagePosition = stageMap.get(normalizedStage) || 999;
				entries.push({
					date: currentDate,
					stage_name: normalizedStage,
					stage_position: mappedStagePosition,
					start_time: time,
					end_time: null,
					artist_name: artist
				});
			}
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
		  SELECT e.id, e.slug, e.date_start, e.date_end, e.name AS name, e.image, v.name AS venue, c.name AS city, c.id AS city_id, v.id AS venue_id, festival.image as festival_image
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
		  SELECT g.id, g.date, g.artist_id, a.name AS artist, a.image, v.name AS venue, v.id AS venue_id, c.name AS city, c.id AS city_id,
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
			artist_id: row.artist_id,
			artist: row.artist,
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
				name: edition[0].name,
				image: edition[0].image ? edition[0].image : edition[0].festival_image,
				venue: { id: edition[0].venue_id, name: edition[0].venue },
				city: { id: edition[0].city_id, name: edition[0].city }
			},
			gigs: gigs
		};
	} catch (error) {
		console.error("Ocorreu um erro ao obter os gigs por edition:", error);
		throw error;
	}
}

async function create(edition) {
	const rows = await db.query(`SELECT id FROM edition WHERE name="${edition.name}"`);
	var result;
	const slug = await buildUniqueSlug(db, "edition", edition?.name, rows?.[0]?.id || null);

	if (rows.length) {
		const id = rows[0].id;
		result = await db.query(`UPDATE edition SET name="${edition.name}", slug="${slug}", festival_id="${edition.festival_id}", image="${edition.image}", city_id="${edition.city.id}", venue_id="${edition.venue.id}" WHERE id=${id}`);
	} else {
		result = await db.query(`INSERT INTO edition (name, slug, festival_id, image, city_id, venue_id) VALUES  ("${edition.name}", "${slug}", "${edition.festival_id}", "${edition.image}", "${edition.city.id}", "${edition.venue.id}")`);
	}

	let message = "Error in creating Edition";

	if (result.affectedRows) {
		message = "Edition created successfully";
	}

	return { message };
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
	const resolvedId = await resolveEntityIdByIdentifier(db, "edition", id);
	if (!resolvedId) {
		return { message: "Edition not found" };
	}

	const slug = await buildUniqueSlug(db, "edition", edition?.name, resolvedId);
	const result = await db.query(`UPDATE edition SET name="${edition.name}", slug="${slug}", image="${edition.image}", city_id="${edition.city.id}", venue_id="${edition.venue.id}" WHERE id=${resolvedId}`);

	let message = "Error in updating Edition";

	if (result.affectedRows) {
		message = "Edition updated successfully";
	}

	return { message };
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

async function previewProgram(editionId, payload = {}) {
	const resolvedEditionId = await resolveEntityIdByIdentifier(db, "edition", editionId);
	if (!resolvedEditionId) {
		throw new Error("Edition not found");
	}

	const editionRows = await db.query(
		`
		SELECT id, name, city_id, venue_id, date_start, date_end
		FROM edition
		WHERE id = ?
		LIMIT 1
		`,
		[resolvedEditionId]
	);

	const edition = editionRows[0];
	if (!edition.city_id || !edition.venue_id) {
		throw new Error("Edition must have city and venue before importing program");
	}

	const editionStartIso = parseIsoDate(edition.date_start);
	const editionEndIso = parseIsoDate(edition.date_end) || editionStartIso;
	const { entries, warnings } = parseProgramText(payload.program, editionStartIso, editionEndIso);

	const summary = {
		total_lines: entries.length,
		create_artist_and_gig: 0,
		create_gig: 0,
		update_gig: 0,
		ignore_duplicate: 0,
		warnings: warnings.length
	};

	if (!entries.length) {
		return {
			message: "No valid lines found to preview",
			summary,
			entries: [],
			warnings
		};
	}

	const uniqueArtistNames = [...new Set(entries.map((entry) => entry.artist_name).filter(Boolean))];
	const artistRowsByName = new Map();
	for (const artistName of uniqueArtistNames) {
		const existingArtistRows = await db.query(`SELECT id, name FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1`, [artistName]);
		if (existingArtistRows.length) {
			artistRowsByName.set(artistName, existingArtistRows[0]);
		}
	}

	const entriesByDate = new Map();
	for (const entry of entries) {
		if (!entriesByDate.has(entry.date)) {
			entriesByDate.set(entry.date, []);
		}
		entriesByDate.get(entry.date).push(entry);
	}

	const previewEntries = [];

	for (const [date, dateEntries] of entriesByDate.entries()) {
		const eventRows = await db.query(
			`
			SELECT e.id
			FROM event e
			INNER JOIN edition_event ee ON ee.event_id = e.id
			WHERE ee.edition_id = ? AND e.date = ?
			ORDER BY e.id ASC
			LIMIT 1
			`,
			[edition.id, date]
		);

		const eventId = eventRows?.[0]?.id || null;
		const existingGigRows = eventId
			? await db.query(
					`
					SELECT eg.gig_id, eg.stage_id, eg.start_time AS event_start_time, eg.end_time AS event_end_time,
					       g.artist_id, g.start_time AS gig_start_time, g.end_time AS gig_end_time,
					       es.name AS stage_name
					FROM event_gig eg
					INNER JOIN gig g ON g.id = eg.gig_id
					LEFT JOIN event_stage es ON es.id = eg.stage_id
					WHERE eg.event_id = ?
					`,
					[eventId]
			  )
			: [];

		const existingEventGigByArtist = new Map();
		for (const gig of existingGigRows) {
			if (!existingEventGigByArtist.has(gig.artist_id)) {
				existingEventGigByArtist.set(gig.artist_id, gig);
			}
		}

		const existingArtistIdsForDate = [...new Set(dateEntries.map((entry) => artistRowsByName.get(entry.artist_name)?.id).filter(Boolean))];
		let existingVenueDateGigRows = [];
		if (existingArtistIdsForDate.length) {
			const artistPlaceholders = existingArtistIdsForDate.map(() => "?").join(",");
			existingVenueDateGigRows = await db.query(
				`
				SELECT id, artist_id, start_time, end_time
				FROM gig
				WHERE venue_id = ? AND date = ? AND artist_id IN (${artistPlaceholders})
				`,
				[edition.venue_id, date, ...existingArtistIdsForDate]
			);
		}

		const existingVenueDateGigByArtist = new Map();
		for (const gig of existingVenueDateGigRows) {
			if (!existingVenueDateGigByArtist.has(gig.artist_id)) {
				existingVenueDateGigByArtist.set(gig.artist_id, gig);
			}
		}

		const processedArtistKeys = new Set();

		for (const entry of dateEntries) {
			const artist = artistRowsByName.get(entry.artist_name) || null;
			const artistKey = artist?.id ? `id:${artist.id}` : `name:${entry.artist_name.toLowerCase()}`;
			let action = "create_artist_and_gig";
			let existingGigId = null;
			let note = "";

			if (processedArtistKeys.has(artistKey)) {
				action = "ignore_duplicate";
				note = "Artista repetido no mesmo dia.";
			} else if (artist?.id) {
				const existingEventGig = existingEventGigByArtist.get(artist.id);
				const existingVenueDateGig = existingVenueDateGigByArtist.get(artist.id);

				if (existingEventGig) {
					existingGigId = existingEventGig.gig_id;
					const currentEventStart = existingEventGig.event_start_time || existingEventGig.gig_start_time || null;
					const currentEventEnd = existingEventGig.event_end_time || existingEventGig.gig_end_time || null;
					const currentStageName = existingEventGig.stage_name || null;
					const hasChanges = currentEventStart !== (entry.start_time || null) || currentEventEnd !== (entry.end_time || null) || (currentStageName || null) !== (entry.stage_name || null);
					action = hasChanges ? "update_gig" : "ignore_duplicate";
					note = hasChanges ? "Já existe, mas palco/horário será atualizado." : "Já existe sem alterações.";
				} else if (existingVenueDateGig) {
					existingGigId = existingVenueDateGig.id;
					action = "update_gig";
					note = "Concerto existente neste local/dia será associado ao evento.";
				} else {
					action = "create_gig";
				}
			}

			processedArtistKeys.add(artistKey);
			summary[action] += 1;

			previewEntries.push({
				date: entry.date,
				stage_name: entry.stage_name,
				start_time: entry.start_time,
				end_time: entry.end_time,
				artist_name: entry.artist_name,
				artist_id: artist?.id || null,
				existing_gig_id: existingGigId,
				action,
				action_label: getImportActionLabel(action),
				note
			});
		}
	}

	return {
		message: "Program preview generated successfully",
		summary,
		entries: previewEntries,
		warnings
	};
}

async function importProgram(editionId, payload = {}) {
	const resolvedEditionId = await resolveEntityIdByIdentifier(db, "edition", editionId);
	if (!resolvedEditionId) {
		throw new Error("Edition not found");
	}

	const editionRows = await db.query(
		`
		SELECT id, name, city_id, venue_id, date_start, date_end
		FROM edition
		WHERE id = ?
		LIMIT 1
		`,
		[resolvedEditionId]
	);

	const edition = editionRows[0];
	if (!edition.city_id || !edition.venue_id) {
		throw new Error("Edition must have city and venue before importing program");
	}

	const editionStartIso = parseIsoDate(edition.date_start);
	const editionEndIso = parseIsoDate(edition.date_end) || editionStartIso;
	const { entries, warnings } = parseProgramText(payload.program, editionStartIso, editionEndIso);

	if (!entries.length) {
		return {
			message: "No valid lines found to import",
			created_artists: 0,
			created_events: 0,
			created_gigs: 0,
			updated_gigs: 0,
			ignored_duplicates: 0,
			warnings
		};
	}

	const type = Number(payload.type) || 1;
	const uniqueArtistNames = [...new Set(entries.map((entry) => entry.artist_name).filter(Boolean))];
	const artistIdByName = new Map();
	let createdArtists = 0;

	for (const artistName of uniqueArtistNames) {
		const existingArtistRows = await db.query(`SELECT id, name FROM artist WHERE LOWER(name) = LOWER(?) LIMIT 1`, [artistName]);
		if (existingArtistRows.length) {
			const currentName = normalizeWhitespace(existingArtistRows[0].name);
			const artistSlug = await buildUniqueSlug(db, "artist", artistName, existingArtistRows[0].id);
			if (currentName && currentName.toLowerCase() === artistName.toLowerCase() && currentName !== artistName) {
				await db.query(`UPDATE artist SET name = ?, slug = ? WHERE id = ?`, [artistName, artistSlug, existingArtistRows[0].id]);
			} else {
				await db.query(`UPDATE artist SET slug = ? WHERE id = ?`, [artistSlug, existingArtistRows[0].id]);
			}
			artistIdByName.set(artistName, existingArtistRows[0].id);
			continue;
		}

		const artistSlug = await buildUniqueSlug(db, "artist", artistName);
		const insertArtist = await db.query(`INSERT INTO artist (name, image, mbid, type, slug) VALUES (?, '', '', ?, ?)`, [artistName, type, artistSlug]);
		artistIdByName.set(artistName, insertArtist.insertId);
		createdArtists += 1;
	}

	const entriesByDate = new Map();
	for (const entry of entries) {
		if (!entriesByDate.has(entry.date)) {
			entriesByDate.set(entry.date, []);
		}
		entriesByDate.get(entry.date).push(entry);
	}

	let createdEvents = 0;
	let createdGigs = 0;
	let updatedGigs = 0;
	let ignoredDuplicates = 0;

	for (const [date, dateEntries] of entriesByDate.entries()) {
		const eventRows = await db.query(
			`
			SELECT e.id
			FROM event e
			INNER JOIN edition_event ee ON ee.event_id = e.id
			WHERE ee.edition_id = ? AND e.date = ?
			ORDER BY e.id ASC
			LIMIT 1
			`,
			[edition.id, date]
		);

		let eventId = null;
		if (eventRows.length) {
			eventId = eventRows[0].id;
		} else {
			const eventName = `${edition.name} · ${date}`;
			const eventDescription = `Programação ${edition.name || ""}`.trim();
			const eventSlug = await buildUniqueSlug(db, "event", eventName);
			const insertEvent = await db.query(`INSERT INTO event (name, slug, date, city_id, venue_id, type, description) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
				eventName,
				eventSlug,
				date,
				edition.city_id,
				edition.venue_id,
				type,
				eventDescription || null
			]);
			eventId = insertEvent.insertId;
			await db.query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [edition.id, eventId]);
			createdEvents += 1;
		}

		const stageRows = await db.query(`SELECT id, name, position FROM event_stage WHERE event_id = ? ORDER BY position ASC, id ASC`, [eventId]);
		const stageByKey = new Map(stageRows.map((row) => [stripAccents((row.name || "").toLowerCase()), row]));

		for (const stageName of [...new Set(dateEntries.map((entry) => entry.stage_name).filter(Boolean))]) {
			const key = stripAccents(stageName.toLowerCase());
			if (!key) {
				continue;
			}

			const stagePosition = dateEntries.find((entry) => entry.stage_name === stageName)?.stage_position || 999;
			if (stageByKey.has(key)) {
				const existingStage = stageByKey.get(key);
				const currentStageName = normalizeWhitespace(existingStage.name);
				const shouldRenameStage = currentStageName && currentStageName.toLowerCase() === stageName.toLowerCase() && currentStageName !== stageName;
				if (shouldRenameStage) {
					await db.query(`UPDATE event_stage SET name = ? WHERE id = ? AND event_id = ?`, [stageName, existingStage.id, eventId]);
					existingStage.name = stageName;
				}
				if (Number(existingStage.position) !== Number(stagePosition)) {
					await db.query(`UPDATE event_stage SET position = ? WHERE id = ? AND event_id = ?`, [stagePosition, existingStage.id, eventId]);
					existingStage.position = stagePosition;
				}
				continue;
			}

			const insertStage = await db.query(`INSERT INTO event_stage (event_id, name, position) VALUES (?, ?, ?)`, [eventId, stageName, stagePosition]);
			stageByKey.set(key, { id: insertStage.insertId, name: stageName, position: stagePosition });
		}

		const existingGigRows = await db.query(
			`
			SELECT eg.gig_id, eg.stage_id, eg.start_time AS event_start_time, eg.end_time AS event_end_time,
			       g.artist_id, g.start_time AS gig_start_time, g.end_time AS gig_end_time
			FROM event_gig eg
			INNER JOIN gig g ON g.id = eg.gig_id
			WHERE eg.event_id = ?
			`,
			[eventId]
		);

		const artistIdsForDate = [...new Set(dateEntries.map((entry) => artistIdByName.get(entry.artist_name)).filter(Boolean))];
		let existingVenueDateGigRows = [];
		if (artistIdsForDate.length) {
			const artistPlaceholders = artistIdsForDate.map(() => "?").join(",");
			existingVenueDateGigRows = await db.query(
				`
				SELECT id, artist_id, start_time, end_time
				FROM gig
				WHERE venue_id = ? AND date = ? AND artist_id IN (${artistPlaceholders})
				`,
				[edition.venue_id, date, ...artistIdsForDate]
			);
		}

		const eventGigByArtist = new Map();
		const eventGigByGigId = new Map();
		for (const gig of existingGigRows) {
			if (!eventGigByArtist.has(gig.artist_id)) {
				eventGigByArtist.set(gig.artist_id, gig);
			}
			eventGigByGigId.set(gig.gig_id, gig);
		}

		const venueDateGigByArtist = new Map();
		for (const gig of existingVenueDateGigRows) {
			if (!venueDateGigByArtist.has(gig.artist_id)) {
				venueDateGigByArtist.set(gig.artist_id, gig);
			}
		}

		const processedArtists = new Set();

		for (const entry of dateEntries) {
			const artistId = artistIdByName.get(entry.artist_name);
			if (!artistId) {
				warnings.push(`Artista não encontrado após criação: "${entry.artist_name}"`);
				continue;
			}

			if (processedArtists.has(artistId)) {
				ignoredDuplicates += 1;
				warnings.push(`Artista repetido no mesmo dia ignorado: "${entry.artist_name}" em ${date}`);
				continue;
			}
			processedArtists.add(artistId);

			const stageKey = stripAccents((entry.stage_name || "").toLowerCase());
			const stageRow = stageByKey.get(stageKey);
			const stageId = stageRow?.id || null;
			const startTime = entry.start_time || null;
			const endTime = entry.end_time || null;

			const existingEventGig = eventGigByArtist.get(artistId);
			if (existingEventGig) {
				const currentEventStart = existingEventGig.event_start_time || existingEventGig.gig_start_time || null;
				const currentEventEnd = existingEventGig.event_end_time || existingEventGig.gig_end_time || null;
				const currentStageId = existingEventGig.stage_id || null;
				const hasChanges = currentStageId !== stageId || currentEventStart !== startTime || currentEventEnd !== endTime;

				if (!hasChanges) {
					ignoredDuplicates += 1;
					continue;
				}

				await db.query(`UPDATE event_gig SET stage_id = ?, start_time = ?, end_time = ? WHERE event_id = ? AND gig_id = ?`, [stageId, startTime, endTime, eventId, existingEventGig.gig_id]);
				await db.query(`UPDATE gig SET start_time = ?, end_time = ? WHERE id = ?`, [startTime, endTime, existingEventGig.gig_id]);
				existingEventGig.stage_id = stageId;
				existingEventGig.event_start_time = startTime;
				existingEventGig.event_end_time = endTime;
				existingEventGig.gig_start_time = startTime;
				existingEventGig.gig_end_time = endTime;
				updatedGigs += 1;
				continue;
			}

			let gigIdToUse = null;
			let createdGigNow = false;
			const existingVenueDateGig = venueDateGigByArtist.get(artistId);
			if (existingVenueDateGig?.id) {
				gigIdToUse = existingVenueDateGig.id;
				await db.query(`UPDATE gig SET start_time = ?, end_time = ? WHERE id = ?`, [startTime, endTime, gigIdToUse]);
			} else {
				try {
					const insertGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
						date,
						edition.city_id,
						edition.venue_id,
						artistId,
						type,
						startTime,
						endTime
					]);
					gigIdToUse = insertGig.insertId;
					createdGigNow = true;
					createdGigs += 1;
				} catch (error) {
					if (error?.code !== "ER_DUP_ENTRY") {
						throw error;
					}

					const duplicateGigRows = await db.query(`SELECT id FROM gig WHERE artist_id = ? AND venue_id = ? AND date = ? LIMIT 1`, [artistId, edition.venue_id, date]);
					if (!duplicateGigRows.length) {
						throw error;
					}

					gigIdToUse = duplicateGigRows[0].id;
					await db.query(`UPDATE gig SET start_time = ?, end_time = ? WHERE id = ?`, [startTime, endTime, gigIdToUse]);
				}
			}

			if (!gigIdToUse) {
				continue;
			}

			if (!eventGigByGigId.has(gigIdToUse)) {
				await db.query(`INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)`, [eventId, gigIdToUse, stageId, startTime, endTime]);
			} else {
				await db.query(`UPDATE event_gig SET stage_id = ?, start_time = ?, end_time = ? WHERE event_id = ? AND gig_id = ?`, [stageId, startTime, endTime, eventId, gigIdToUse]);
			}

			const gigSnapshot = {
				gig_id: gigIdToUse,
				artist_id: artistId,
				stage_id: stageId,
				event_start_time: startTime,
				event_end_time: endTime,
				gig_start_time: startTime,
				gig_end_time: endTime
			};
			eventGigByArtist.set(artistId, gigSnapshot);
			eventGigByGigId.set(gigIdToUse, gigSnapshot);
			venueDateGigByArtist.set(artistId, { id: gigIdToUse, artist_id: artistId, start_time: startTime, end_time: endTime });
			if (!createdGigNow) {
				updatedGigs += 1;
			}
		}
	}

	return {
		message: "Program imported successfully",
		created_artists: createdArtists,
		created_events: createdEvents,
		created_gigs: createdGigs,
		updated_gigs: updatedGigs,
		ignored_duplicates: ignoredDuplicates,
		warnings
	};
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
