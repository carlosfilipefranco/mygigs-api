const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { getEditionIdsForGig, syncEditionDatesForEditionIds } = require("./editionDates");

function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeNumber(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
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

function normalizeTime(value) {
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

	const match = trimmed.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) {
		return undefined;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3] || "0");

	if (hours > 23 || minutes > 59 || seconds > 59) {
		return undefined;
	}

	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeStageName(value) {
	if (value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed || null;
}

async function resolveStageId(eventId, inputStageId, inputStageName) {
	if (!eventId) {
		return null;
	}

	const stageId = normalizeNumber(inputStageId);
	if (stageId) {
		const stageRows = await db.query(`SELECT id FROM event_stage WHERE id = ? AND event_id = ? LIMIT 1`, [stageId, eventId]);
		if (stageRows.length) {
			return stageRows[0].id;
		}
	}

	const stageName = normalizeStageName(inputStageName);
	if (stageName === undefined) {
		return undefined;
	}
	if (!stageName) {
		return null;
	}

	const existingRows = await db.query(`SELECT id, name FROM event_stage WHERE event_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, [eventId, stageName]);
	if (existingRows.length) {
		const existing = existingRows[0];
		if (existing.name !== stageName && existing.name?.toLowerCase() === stageName.toLowerCase()) {
			await db.query(`UPDATE event_stage SET name = ? WHERE id = ? AND event_id = ?`, [stageName, existing.id, eventId]);
		}
		return existing.id;
	}

	const positionRows = await db.query(`SELECT COALESCE(MAX(position), 0) AS max_position FROM event_stage WHERE event_id = ?`, [eventId]);
	const nextPosition = Number(positionRows?.[0]?.max_position || 0) + 1;
	const insertResult = await db.query(`INSERT INTO event_stage (event_id, name, position) VALUES (?, ?, ?)`, [eventId, stageName, nextPosition]);
	return insertResult.insertId;
}

async function getMultiple(userId, page = 1, search = null, favorite = null, type = 1, period = null, mine = null, order = "date") {
	const offset = helper.getOffset(page, config.listPerPage);
	const normalizedType = Number(type) || 1;
	const normalizedSearch = search ? `${search}`.toLowerCase().trim() : null;
	const favoriteOnly = favorite === 1 || favorite === "1" || favorite === true || favorite === "true";
	const mineOnly = mine === 1 || mine === "1" || mine === true || mine === "true";
	const normalizedOrder = order === "latest" ? "latest" : "date";

	if (mineOnly && !userId) {
		return {
			data: [],
			meta: { page: Number(page) || 1, count: 0 }
		};
	}

	const filters = ["gig.type = ?"];
	const params = [normalizedType];
	let orderBy = normalizedOrder === "latest" ? "gig.id DESC" : "gig.date DESC, gig.position";

	if (normalizedSearch) {
		const query = `%${normalizedSearch}%`;
		filters.push("(LOWER(artist.name) LIKE ? OR LOWER(venue.name) LIKE ? OR LOWER(city.name) LIKE ? OR LOWER(gig.date) LIKE ?)");
		params.push(query, query, query, query);
	}

	if (period === "upcoming") {
		filters.push("gig.date >= CURDATE()");
		orderBy = normalizedOrder === "latest" ? "gig.id DESC" : "gig.date ASC, gig.position";
	} else if (period === "past") {
		filters.push("gig.date < CURDATE()");
		orderBy = normalizedOrder === "latest" ? "gig.id DESC" : "gig.date DESC, gig.position";
	}

	if (mineOnly) {
		filters.push("ug.status = 'going'");
	}

	if (favoriteOnly) {
		filters.push("ug.favorite = 1");
	}

	const whereClause = `WHERE ${filters.join(" AND ")}`;
	const queryParams = [userId, ...params];

	const rows = await db.query(
		`
		SELECT
			gig.id,
			gig.date,
			artist.id AS artist_id,
			artist.name AS artist,
			artist.slug AS artist_slug,
			artist.image,
			venue.name AS venue,
			city.name AS city,
			(
				SELECT COUNT(*)
				FROM user_gig ugc
				WHERE ugc.gig_id = gig.id
				  AND ugc.status = 'going'
				  AND gig.date < CURDATE()
			) AS went_count,
			(
				SELECT COUNT(*)
				FROM user_gig ugc
				WHERE ugc.gig_id = gig.id
				  AND ugc.status = 'going'
				  AND gig.date >= CURDATE()
			) AS interested_count,
			CASE WHEN setlist.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_setlist,
			ug.status AS status,
			COALESCE(ug.favorite, 0) AS favorite
		FROM gig
		INNER JOIN artist ON gig.artist_id = artist.id
		INNER JOIN venue ON gig.venue_id = venue.id
		INNER JOIN city ON gig.city_id = city.id
		LEFT JOIN setlist ON setlist.gig_id = gig.id
		LEFT JOIN user_gig ug
			ON ug.gig_id = gig.id
			AND ug.user_id = ?
		${whereClause}
		ORDER BY ${orderBy}
		LIMIT ${offset}, ${config.listPerPage}
		`,
		queryParams
	);

	const countRows = await db.query(
		`
		SELECT COUNT(DISTINCT gig.id) AS count
		FROM gig
		INNER JOIN artist ON gig.artist_id = artist.id
		INNER JOIN venue ON gig.venue_id = venue.id
		INNER JOIN city ON gig.city_id = city.id
		LEFT JOIN user_gig ug
			ON ug.gig_id = gig.id
			AND ug.user_id = ?
		${whereClause}
		`,
		queryParams
	);

	const rowsWithUserGig = helper.emptyOrRows(rows).map((row) => {
		const status = row?.status || "not_going";
		const favorite = Number(row?.favorite || 0) === 1;

		return {
			...row,
			user_gig: userId
				? {
						status,
						favorite
				  }
				: null
		};
	});

	return {
		data: rowsWithUserGig,
		meta: { page: Number(page) || 1, count: countRows[0]?.count || 0 }
	};
}

async function get(id, userId = null) {
	const result = await db.query(
		`
    SELECT
        gig.id,
        gig.date,
        gig.start_time AS gig_start_time,
        gig.end_time AS gig_end_time,
        artist.name AS artist,
        artist.image,
        artist.id AS artist_id,
        artist.slug AS artist_slug,
        venue.name AS venue,
        venue.id AS venue_id,
        city.name AS city,
        eg.stage_id,
        es.name AS stage_name,
        eg.start_time AS event_start_time,
        eg.end_time AS event_end_time,
        ev.id AS event_id,
        ev.name AS event_name,
        ev.slug AS event_slug,
        festival.id AS festival_id,
        festival.name AS festival_name,
        edition.id AS edition_id,
        edition.name AS edition_name,
        edition.slug AS edition_slug
    FROM gig
    INNER JOIN artist ON gig.artist_id = artist.id
    INNER JOIN venue ON gig.venue_id = venue.id
    INNER JOIN city ON gig.city_id = city.id
    LEFT JOIN event_gig eg ON gig.id = eg.gig_id
    LEFT JOIN event_stage es ON es.id = eg.stage_id
    LEFT JOIN event ev ON eg.event_id = ev.id
    LEFT JOIN edition_event ee ON eg.event_id = ee.event_id
    LEFT JOIN edition ON ee.edition_id = edition.id
    LEFT JOIN festival ON edition.festival_id = festival.id
    WHERE gig.id = ?
  `,
		[id]
	);

	if (result.length === 0) return null;

	const gig = result[0];
	gig.start_time = gig.event_start_time || gig.gig_start_time || null;
	gig.end_time = gig.event_end_time || gig.gig_end_time || null;

	const crowdRows = await db.query(
		`
		SELECT
			SUM(CASE WHEN ug.status = 'going' AND g.date < CURDATE() THEN 1 ELSE 0 END) AS went_count,
			SUM(CASE WHEN ug.status = 'going' AND g.date >= CURDATE() THEN 1 ELSE 0 END) AS interested_count
		FROM gig g
		LEFT JOIN user_gig ug ON ug.gig_id = g.id
		WHERE g.id = ?
		`,
		[id]
	);

	gig.went_count = Number(crowdRows?.[0]?.went_count || 0);
	gig.interested_count = Number(crowdRows?.[0]?.interested_count || 0);

	gig.attendees = await db.query(
		`
		SELECT user.id, user.name, user.image
		FROM user_gig ug
		INNER JOIN user ON user.id = ug.user_id
		WHERE ug.gig_id = ?
		  AND ug.status = 'going'
		ORDER BY user.name ASC
		LIMIT 12
		`,
		[id]
	);

	// 🔥 Buscar media (imagens, videos, links)
	const mediaRows = await db.query(`SELECT url, type FROM gig_media WHERE gig_id = ?`, [id]);
	gig.images = mediaRows.filter((m) => m.type === "image").map((m) => m.url);
	gig.videos = mediaRows.filter((m) => m.type === "video").map((m) => m.url);
	gig.links = mediaRows.filter((m) => m.type === "link").map((m) => m.url);

	// 🔥 Se houver login, buscar user_gig
	if (userId) {
		const userGigRows = await db.query(`SELECT status, favorite FROM user_gig WHERE gig_id = ? AND user_id = ?`, [id, userId]);
		if (userGigRows.length > 0) {
			gig.user_gig = userGigRows[0];
		} else {
			gig.user_gig = { status: null, favorite: false };
		}
	}

	// Procurar setlist local
	const setlistRows = await db.query(
		`
    SELECT
        s.id AS setlist_id,
        ss.song_id,
        ss.position,
        ss.encore,
        song.name AS song_name
    FROM setlist s
    JOIN setlist_song ss ON ss.setlist_id = s.id
    JOIN song ON ss.song_id = song.id
    WHERE s.gig_id = ?
    ORDER BY ss.encore IS NULL, ss.encore, ss.position
    `,
		[id]
	);

	if (setlistRows.length > 0) {
		const setsMap = new Map();

		for (const row of setlistRows) {
			const key = row.encore ?? 0;
			if (!setsMap.has(key)) {
				setsMap.set(key, []);
			}
			setsMap.get(key).push({ name: row.song_name });
		}

		const orderedKeys = Array.from(setsMap.keys()).sort((a, b) => a - b);

		const sets = orderedKeys.map((encore) => ({
			...(encore > 0 ? { encore } : {}),
			song: setsMap.get(encore).map((s, i) => ({ ...s, number: i + 1 }))
		}));

		gig.setlist = {
			sets: {
				set: sets
			}
		};
	}

	return gig;
}

function resolveScope(userId, scope) {
	const normalizedScope = scope === "me" || scope === "global" ? scope : null;
	if (normalizedScope === "me" && !userId) {
		return "global";
	}
	if (normalizedScope) {
		return normalizedScope;
	}
	return userId ? "me" : "global";
}

function buildPeriodClause(period, field = "gig.date", options = {}) {
	const includeNullOnPast = !!options.includeNullOnPast;

	if (period === "upcoming") {
		return ` AND ${field} >= CURDATE()`;
	}
	if (period === "past") {
		if (includeNullOnPast) {
			return ` AND (${field} < CURDATE() OR ${field} IS NULL)`;
		}
		return ` AND ${field} < CURDATE()`;
	}
	return "";
}

function emptyDashboard() {
	return {
		total_gigs: { total_gigs: 0 },
		gigs_by_year: [],
		gigs_by_artist: [],
		editions_by_festival: []
	};
}

async function dashboard(type = 1, userId = null, period = null, scope = null) {
	const normalizedType = Number(type) || 1;
	const resolvedScope = resolveScope(userId, scope);

	if (resolvedScope === "me") {
		if (!userId) {
			return emptyDashboard();
		}
		return normalizedType === 2 ? userEventDashboard(normalizedType, userId, period) : userGigDashboard(normalizedType, userId, period);
	}

	return globalDashboard(normalizedType, period);
}

async function globalDashboard(type, period = null) {
	const periodClause = buildPeriodClause(period, "gig.date");
	const total_gigs = await db.query(`SELECT COUNT(*) AS total_gigs FROM gig WHERE type = ?${periodClause}`, [type]);
	const gigs_by_year = await db.query(`SELECT YEAR(date) AS year, COUNT(*) AS gig_count FROM gig WHERE type = ?${periodClause} GROUP BY YEAR(date) ORDER BY YEAR(date);`, [type]);
	const gigs_by_artist = await db.query(
		`
		SELECT artist.id, artist.name, artist.slug, artist.image, artist.id as artist_id, COUNT(gig.id) AS gig_count
		FROM artist
		LEFT JOIN gig ON artist.id = gig.artist_id
		WHERE gig.type = ?${periodClause}
		GROUP BY artist.id, artist.name, artist.slug, artist.image
		ORDER BY gig_count DESC;
		`,
		[type]
	);
	const editions_by_festival = await db.query(
		`
		SELECT
			festival.id,
			festival.name,
			festival.slug,
			festival.image,
			COUNT(DISTINCT edition.id) AS edition_count,
			COUNT(DISTINCT event_gig.event_id) AS total_events
		FROM festival
		INNER JOIN edition ON festival.id = edition.festival_id
		INNER JOIN edition_event ON edition_event.edition_id = edition.id
		INNER JOIN event_gig ON event_gig.event_id = edition_event.event_id
		INNER JOIN gig ON gig.id = event_gig.gig_id
		WHERE gig.type = ?${periodClause}
		GROUP BY festival.id, festival.name, festival.slug, festival.image
		ORDER BY edition_count DESC, total_events DESC
		`,
		[type]
	);
	const data = {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival
	};
	return data;
}

async function userGigDashboard(type, userId, period = null) {
	const periodClause = buildPeriodClause(period, "gig.date", { includeNullOnPast: true });
	const total_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT gig.id) AS total_gigs
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		`,
		[userId, type]
	);
	const gigs_by_year = await db.query(
		`
		SELECT YEAR(gig.date) AS year, COUNT(DISTINCT gig.id) AS gig_count
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		GROUP BY YEAR(gig.date)
		ORDER BY YEAR(gig.date)
		`,
		[userId, type]
	);
	const gigs_by_artist = await db.query(
		`
		SELECT artist.id, artist.name, artist.slug, artist.image, artist.id as artist_id, COUNT(DISTINCT gig.id) AS gig_count
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		INNER JOIN artist ON artist.id = gig.artist_id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		GROUP BY artist.id, artist.name, artist.slug, artist.image
		ORDER BY gig_count DESC
		`,
		[userId, type]
	);
	const editions_by_festival = await db.query(
		`
		SELECT
			festival.id,
			festival.name,
			festival.slug,
			festival.image,
			COUNT(DISTINCT edition.id) AS edition_count,
			COUNT(DISTINCT event_gig.event_id) AS total_events
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		INNER JOIN event_gig ON event_gig.gig_id = gig.id
		INNER JOIN edition_event ON edition_event.event_id = event_gig.event_id
		INNER JOIN edition ON edition.id = edition_event.edition_id
		INNER JOIN festival ON festival.id = edition.festival_id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		GROUP BY festival.id, festival.name, festival.slug, festival.image
		ORDER BY edition_count DESC, total_events DESC
		`,
		[userId, type]
	);

	return {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival
	};
}

async function userEventDashboard(type, userId, period = null) {
	const countedStatuses = ["going", "attended"];
	const periodClause = buildPeriodClause(period, "event.date");
	const total_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT event.id) AS total_gigs
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		`,
		[userId, ...countedStatuses, type]
	);
	const gigs_by_year = await db.query(
		`
		SELECT YEAR(event.date) AS year, COUNT(DISTINCT event.id) AS gig_count
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		GROUP BY YEAR(event.date)
		ORDER BY YEAR(event.date)
		`,
		[userId, ...countedStatuses, type]
	);
	const gigs_by_artist = await db.query(
		`
		SELECT artist.id, artist.name, artist.slug, artist.image, artist.id as artist_id, COUNT(DISTINCT event.id) AS gig_count
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		INNER JOIN event_gig ON event_gig.event_id = event.id
		INNER JOIN gig ON gig.id = event_gig.gig_id
		INNER JOIN artist ON artist.id = gig.artist_id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		GROUP BY artist.id, artist.name, artist.slug, artist.image
		ORDER BY gig_count DESC
		`,
		[userId, ...countedStatuses, type]
	);
	const editions_by_festival = await db.query(
		`
		SELECT
			festival.id,
			festival.name,
			festival.slug,
			festival.image,
			COUNT(DISTINCT edition.id) AS edition_count,
			COUNT(DISTINCT event.id) AS total_events
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		INNER JOIN edition_event ON edition_event.event_id = event.id
		INNER JOIN edition ON edition.id = edition_event.edition_id
		INNER JOIN festival ON festival.id = edition.festival_id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		GROUP BY festival.id, festival.name, festival.slug, festival.image
		ORDER BY edition_count DESC, total_events DESC
		`,
		[userId, ...countedStatuses, type]
	);

	return {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival
	};
}

async function create(gigs) {
	gigs.forEach(async (gig, index) => {
		var artist = await db.query(`SELECT id FROM artist WHERE name="${gig.artist}"`);
		if (!artist.length) {
			artist = await db.query(`INSERT INTO artist (name)  VALUES  ("${gig.artist}")`);
		}
		var city = await db.query(`SELECT id FROM city WHERE name="${gig.city}"`);
		if (!city.length) {
			city = await db.query(`INSERT INTO city (name)  VALUES  ("${gig.city}")`);
		}
		var venue = await db.query(`SELECT id FROM venue WHERE name="${gig.venue}"`);
		if (!venue.length) {
			venue = await db.query(`INSERT INTO venue (name)  VALUES  ("${gig.venue}")`);
		}
		let insert = `INSERT INTO gig (artist_id, venue_id, city_id)  VALUES  ("${artist[0].id}", "${venue[0].id}", "${city[0].id}")`;
		var date = null;
		if (gig.date && gig.date != "*") {
			var dateParts = gig.date.split("-");
			var dateObject = new Date(+dateParts[2], dateParts[1] - 1, +dateParts[0]);
			date = new Date(dateObject).toISOString().split("T")[0];
			insert = `INSERT INTO gig (artist_id, venue_id, city_id, position, date)  VALUES  ("${artist[0].id}", "${venue[0].id}", "${city[0].id}", "${index}", "${date}")`;
		}
		const result = await db.query(insert);

		// if (result.affectedRows) {
		// 	message = "gig created successfully";
		// }
	});

	let message = "finished";

	return { message };
}

async function sort(gigs) {
	let result = "";
	gigs.forEach(async (gig) => {
		result = await db.query(`UPDATE gig SET position="${gig.position}" WHERE id="${gig.id}"`);
	});

	let message = "finished";

	return { message };
}

async function images(images) {
	for (const image of images) {
		await db.query(`
            INSERT INTO gig_image (gig_id, url)
            VALUES ("${image.gig_id}", "${image.url}")
        `);
	}

	let message = "All images inserted successfully";

	return { message };
}

async function update(id, gig) {
	const gigId = normalizeNumber(id);
	if (!gigId) {
		throw new Error("Gig inválido");
	}

	const currentRows = await db.query(`SELECT id, date, start_time, end_time, artist_id FROM gig WHERE id = ? LIMIT 1`, [gigId]);
	if (!currentRows.length) {
		throw new Error("Gig não encontrado");
	}

	const linkedEditionIds = await getEditionIdsForGig(gigId);
	const nextArtistId = hasOwn(gig, "artist_id") ? normalizeNumber(gig.artist_id) : undefined;
	const nextDate = hasOwn(gig, "date") ? normalizeDate(gig.date) : undefined;
	const nextStartTime = hasOwn(gig, "start_time") ? normalizeTime(gig.start_time) : undefined;
	const nextEndTime = hasOwn(gig, "end_time") ? normalizeTime(gig.end_time) : undefined;
	const nextStageName = hasOwn(gig, "stage_name") ? normalizeStageName(gig.stage_name) : undefined;
	const providedEventId = hasOwn(gig, "event_id") ? normalizeNumber(gig.event_id) : null;

	if (hasOwn(gig, "artist_id") && !nextArtistId) {
		throw new Error("Artista inválido.");
	}
	if (hasOwn(gig, "date") && nextDate === undefined) {
		throw new Error("Data inválida. Usa o formato YYYY-MM-DD.");
	}
	if (hasOwn(gig, "start_time") && nextStartTime === undefined) {
		throw new Error("Hora de início inválida. Usa HH:mm ou HH:mm:ss.");
	}
	if (hasOwn(gig, "end_time") && nextEndTime === undefined) {
		throw new Error("Hora de fim inválida. Usa HH:mm ou HH:mm:ss.");
	}
	if (hasOwn(gig, "stage_name") && nextStageName === undefined) {
		throw new Error("Nome de palco inválido.");
	}
	if (hasOwn(gig, "event_id") && gig.event_id !== null && gig.event_id !== "" && !providedEventId) {
		throw new Error("event_id inválido.");
	}
	if (nextArtistId) {
		const artistRows = await db.query(`SELECT id FROM artist WHERE id = ? LIMIT 1`, [nextArtistId]);
		if (!artistRows.length) {
			throw new Error("Artista não encontrado.");
		}
	}

	let affectedRows = 0;
	const gigFields = [];
	const gigParams = [];

	if (hasOwn(gig, "artist_id")) {
		gigFields.push("artist_id = ?");
		gigParams.push(nextArtistId);
	}
	if (hasOwn(gig, "date")) {
		gigFields.push("date = ?");
		gigParams.push(nextDate);
	}
	if (hasOwn(gig, "start_time")) {
		gigFields.push("start_time = ?");
		gigParams.push(nextStartTime);
	}
	if (hasOwn(gig, "end_time")) {
		gigFields.push("end_time = ?");
		gigParams.push(nextEndTime);
	}

	if (gigFields.length) {
		const updateResult = await db.query(`UPDATE gig SET ${gigFields.join(", ")} WHERE id = ?`, [...gigParams, gigId]);
		affectedRows += Number(updateResult.affectedRows || 0);
	}
	if (hasOwn(gig, "artist_id")) {
		const setlistUpdate = await db.query(`UPDATE setlist SET artist_id = ? WHERE gig_id = ?`, [nextArtistId, gigId]);
		affectedRows += Number(setlistUpdate.affectedRows || 0);
	}

	const shouldUpdateEventGig =
		hasOwn(gig, "event_id") ||
		hasOwn(gig, "stage_name") ||
		hasOwn(gig, "stage_id") ||
		hasOwn(gig, "start_time") ||
		hasOwn(gig, "end_time");

	if (shouldUpdateEventGig) {
		const eventGigRows = await db.query(`SELECT event_id, stage_id, start_time, end_time FROM event_gig WHERE gig_id = ?`, [gigId]);
		if (eventGigRows.length) {
			let targetRows = eventGigRows;
			if (providedEventId) {
				targetRows = eventGigRows.filter((row) => Number(row.event_id) === providedEventId);
				if (!targetRows.length) {
					throw new Error("Este concerto não pertence ao evento indicado.");
				}
			} else if ((hasOwn(gig, "stage_name") || hasOwn(gig, "stage_id")) && eventGigRows.length > 1) {
				throw new Error("Indica event_id para editar palco quando o concerto pertence a vários eventos.");
			}

			for (const row of targetRows) {
				const eventId = Number(row.event_id);
				const stageId = hasOwn(gig, "stage_name") || hasOwn(gig, "stage_id") ? await resolveStageId(eventId, gig.stage_id, nextStageName) : row.stage_id;
				if (stageId === undefined) {
					throw new Error("Palco inválido.");
				}

				const eventStartTime = hasOwn(gig, "start_time") ? nextStartTime : row.start_time;
				const eventEndTime = hasOwn(gig, "end_time") ? nextEndTime : row.end_time;
				const result = await db.query(`UPDATE event_gig SET stage_id = ?, start_time = ?, end_time = ? WHERE event_id = ? AND gig_id = ?`, [stageId, eventStartTime, eventEndTime, eventId, gigId]);
				affectedRows += Number(result.affectedRows || 0);
			}
		}
	}

	if (!affectedRows) {
		return { message: "No changes" };
	}

	await syncEditionDatesForEditionIds(linkedEditionIds);

	return { message: "gig updated successfully" };
}

async function remove(id, options = {}) {
	const gigId = normalizeNumber(id);
	if (!gigId) {
		throw new Error("Gig inválido");
	}

	const expectedConfirmation = `APAGAR ${gigId}`;
	if (options.confirmation !== expectedConfirmation) {
		const error = new Error(`Confirmação inválida. Escreve "${expectedConfirmation}" para apagar este concerto.`);
		error.statusCode = 400;
		throw error;
	}

	const result = await db.transaction(async (query) => {
		const linkedEditionIds = await getEditionIdsForGig(gigId, query);

		await query(`DELETE FROM setlist_song WHERE setlist_id IN (SELECT id FROM setlist WHERE gig_id = ?)`, [gigId]);
		await query(`DELETE FROM setlist WHERE gig_id = ?`, [gigId]);
		await query(`DELETE FROM gig_media WHERE gig_id = ?`, [gigId]);
		await query(`DELETE FROM user_gig WHERE gig_id = ?`, [gigId]);
		await query(`DELETE FROM event_gig WHERE gig_id = ?`, [gigId]);

		const deleteResult = await query(`DELETE FROM gig WHERE id = ?`, [gigId]);
		await syncEditionDatesForEditionIds(linkedEditionIds, query);

		return deleteResult;
	});

	return {
		message: result.affectedRows ? "gig deleted successfully" : "Error in deleting gig"
	};
}

async function clean() {
	const result = await db.query(`TRUNCATE TABLE gig`);

	let message = "Error in cleaning gigs";

	if (result.affectedRows) {
		message = "Gig has been cleaned";
	}

	return { message };
}

async function addMedia(gigId, body) {
	const { url, type } = body;

	if (!url || !type) {
		throw new Error("url e type são obrigatórios");
	}

	await db.query(`INSERT INTO gig_media (gig_id, url, type) VALUES (?, ?, ?)`, [gigId, url, type]);

	return { success: true };
}

async function updateMedia(gigId, mediaId, body) {
	const { url, type } = body;

	const result = await db.query(`UPDATE gig_media SET url=?, type=? WHERE id=? AND gig_id=?`, [url, type, mediaId, gigId]);

	if (result.affectedRows === 0) {
		throw new Error("Media não encontrado");
	}

	return { success: true };
}

async function deleteMedia(gigId, mediaId) {
	const result = await db.query(`DELETE FROM gig_media WHERE id=? AND gig_id=?`, [mediaId, gigId]);

	if (result.affectedRows === 0) {
		throw new Error("Media não encontrado");
	}

	return { success: true };
}

module.exports = {
	getMultiple,
	get,
	create,
	update,
	remove,
	clean,
	dashboard,
	sort,
	images,
	addMedia,
	updateMedia,
	deleteMedia
};
