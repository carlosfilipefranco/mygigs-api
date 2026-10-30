const db = require("./db");
const { geographyFilter } = require("./geography");
const { getUserPhotos } = require("./userPhotos");
const helper = require("../helper");
const config = require("../config");
const { selectVenue, findVenueByName, selectedAlias, assertPhysicalVenueName } = require("./venueNames");
const { getEditionIdsForGig, syncEditionDatesForEditionIds } = require("./editionDates");
const reviewPreview = require("./reviewPreview");
const { editionDate, upcomingGig, gigSortDate, upcomingEvent, eventEditionDate } = require("./concertDates");
const festivalProgram = require("./festivalProgram");
const { normalizeCityName } = require("./city");

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

async function resolveStageId(eventId, inputStageId, inputStageName, query = db.query) {
	if (!eventId) {
		return null;
	}

	const stageId = normalizeNumber(inputStageId);
	if (stageId) {
		const stageRows = await query(`SELECT id FROM event_stage WHERE id = ? AND event_id = ? LIMIT 1`, [stageId, eventId]);
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

	const existingRows = await query(`SELECT id, name FROM event_stage WHERE event_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, [eventId, stageName]);
	if (existingRows.length) {
		const existing = existingRows[0];
		if (existing.name !== stageName && existing.name?.toLowerCase() === stageName.toLowerCase()) {
			await query(`UPDATE event_stage SET name = ? WHERE id = ? AND event_id = ?`, [stageName, existing.id, eventId]);
		}
		return existing.id;
	}

	const positionRows = await query(`SELECT COALESCE(MAX(position), 0) AS max_position FROM event_stage WHERE event_id = ?`, [eventId]);
	const nextPosition = Number(positionRows?.[0]?.max_position || 0) + 1;
	const insertResult = await query(`INSERT INTO event_stage (event_id, name, position) VALUES (?, ?, ?)`, [eventId, stageName, nextPosition]);
	return insertResult.insertId;
}

async function getMultiple(userId, page = 1, search = null, favorite = null, type = 1, period = null, mine = null, order = "date", geography = {}) {
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
		filters.push(`(LOWER(artist.name) LIKE ? OR (LOWER(venue.name) LIKE ? OR EXISTS (SELECT 1 FROM venue_alias vn WHERE vn.venue_id = venue.id AND LOWER(vn.name) LIKE ?)) OR LOWER(city.name) LIKE ? OR LOWER(COALESCE(gig.date, ${editionDate()})) LIKE ?)`);
		params.push(query, query, query, query, query);
	}

	if (period === "upcoming") {
		filters.push(upcomingGig());
		orderBy = normalizedOrder === "latest" ? "gig.id DESC" : `${gigSortDate()} ASC, gig.date IS NULL, gig.position, gig.id`;
	} else if (period === "past") {
		filters.push(buildPeriodFilter(period, "gig.date", { includeNullOnPast: mineOnly }));
		orderBy = normalizedOrder === "latest" ? "gig.id DESC" : "gig.date DESC, gig.position, gig.id";
	}

	if (mineOnly) {
		filters.push("ug.status = 'going'");
	}

	if (favoriteOnly) {
		filters.push("ug.favorite = 1 AND ug.status = 'going' AND gig.date < CURDATE()");
	}

	const geo = geographyFilter(geography);
	if (geo.predicate) { filters.push(geo.predicate); params.push(...geo.params); }
	const whereClause = `WHERE ${filters.join(" AND ")}`;
	const queryParams = [userId, ...params];

	const rows = await db.query(
		`
		SELECT
			gig.id,
			gig.date,
			${editionDate()} AS edition_date_start, ${editionDate("gig", "date_end")} AS edition_date_end,
			artist.id AS artist_id,
			artist.name AS artist,
			artist.slug AS artist_slug,
			artist.image,
			COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id = gig.venue_alias_id AND vn.venue_id = venue.id), venue.name) AS venue,
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
				  AND ${upcomingGig()}
			) AS interested_count,
			CASE WHEN setlist.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_setlist,
			ug.status AS status,
			CASE WHEN ug.status = 'going' AND gig.date < CURDATE() THEN COALESCE(ug.favorite, 0) ELSE 0 END AS favorite
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
        COALESCE(va.name, venue.name) AS venue,
        venue.name AS venue_current_name,
        gig.venue_alias_id,
        venue.city_id AS venue_city_id,
        (SELECT name FROM city WHERE id = venue.city_id) AS venue_city,
        venue.id AS venue_id,
        city.name AS city,
        city.id AS city_id,
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
        edition.slug AS edition_slug,
        edition.date_start AS edition_date_start, edition.date_end AS edition_date_end
    FROM gig
    INNER JOIN artist ON gig.artist_id = artist.id
    INNER JOIN venue ON gig.venue_id = venue.id
    LEFT JOIN venue_alias va ON va.id = gig.venue_alias_id AND va.venue_id = venue.id
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
	gig.venue_aliases = await db.query(`SELECT id, name FROM venue_alias WHERE venue_id = ? ORDER BY name`, [gig.venue_id]);
	gig.start_time = gig.event_start_time || gig.gig_start_time || null;
	gig.end_time = gig.event_end_time || gig.gig_end_time || null;

	const crowdRows = await db.query(
		`
		SELECT
			SUM(CASE WHEN ug.status = 'going' AND g.date < CURDATE() THEN 1 ELSE 0 END) AS went_count,
			SUM(CASE WHEN ug.status = 'going' AND ${upcomingGig('g')} THEN 1 ELSE 0 END) AS interested_count
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
	const mediaRows = await db.query(
		`SELECT gm.id, gm.gig_id, gm.url, gm.type, gm.user_id, u.name AS user_name
		 FROM gig_media gm
		 LEFT JOIN user u ON u.id = gm.user_id
		 WHERE gm.gig_id = ? ORDER BY gm.id DESC`,
		[id]
	);
	gig.photos = mediaRows.filter((m) => m.type === "image");
	gig.images = mediaRows.filter((m) => m.type === "image").map((m) => m.url);
	gig.videos = mediaRows.filter((m) => m.type === "video").map((m) => m.url);
	gig.links = mediaRows.filter((m) => m.type === "link").map((m) => m.url);
	gig.reviews = mediaRows.filter((m) => m.type === "link").map((m) => ({ ...m, gig_id: gig.id }));

	// 🔥 Se houver login, buscar user_gig
	if (userId) {
		const userGigRows = await db.query(
			`
			SELECT ug.status,
			       CASE WHEN ug.status = 'going' AND gig.date < CURDATE() THEN ug.favorite ELSE 0 END AS favorite
			FROM user_gig ug
			INNER JOIN gig ON gig.id = ug.gig_id
			WHERE ug.gig_id = ? AND ug.user_id = ?
			`,
			[id, userId]
		);
		if (userGigRows.length > 0) {
			gig.user_gig = {
				status: userGigRows[0].status,
				favorite: Number(userGigRows[0].favorite || 0) === 1
			};
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

function buildPeriodFilter(period, field = "gig.date", options = {}) {
	const includeNullOnPast = !!options.includeNullOnPast;

	if (period === "upcoming") {
		return field === "gig.date" ? upcomingGig() : field === "event.date" ? upcomingEvent() : `${field} >= CURDATE()`;
	}
	if (period === "past") {
		if (includeNullOnPast) {
			return `(${field} < CURDATE() OR (${field} IS NULL AND NOT EXISTS (SELECT 1 FROM event_gig cdg INNER JOIN edition_event cde ON cde.event_id = cdg.event_id WHERE cdg.gig_id = gig.id)))`;
		}
		return `${field} < CURDATE()`;
	}
	return "";
}

function buildPeriodClause(period, field = "gig.date", options = {}) {
	const filter = buildPeriodFilter(period, field, options);
	return filter ? ` AND ${filter}` : "";
}

function emptyDashboard() {
	return {
		total_gigs: { total_gigs: 0 },
		gigs_by_year: [],
		gigs_by_artist: [],
		editions_by_festival: [],
		summary: {
			total_artists: 0,
			total_editions: 0,
			total_events: 0,
			upcoming_gigs: 0
		}
	};
}

async function dashboard(type = 1, userId = null, period = null, scope = null, geography = {}) {
	const normalizedType = Number(type) || 1;
	const resolvedScope = resolveScope(userId, scope);

	if (resolvedScope === "me") {
		if (!userId) {
			return emptyDashboard();
		}
		return normalizedType === 2 ? userEventDashboard(normalizedType, userId, period, geography) : userGigDashboard(normalizedType, userId, period, geography);
	}

	return globalDashboard(normalizedType, period, geography);
}

async function globalDashboard(type, period = null, geography = {}) {
	const geo = geographyFilter(geography);
	const periodClause = buildPeriodClause(period, "gig.date") + geo.clause;
	const total_gigs = await db.query(`SELECT COUNT(*) AS total_gigs FROM gig WHERE type = ?${periodClause}`, [type, ...geo.params]);
	const gigs_by_year = await db.query(`SELECT YEAR(COALESCE(gig.date, ${editionDate()})) AS year, COUNT(*) AS gig_count FROM gig WHERE type = ?${periodClause} GROUP BY year ORDER BY year;`, [type, ...geo.params]);
	const gigs_by_artist = await db.query(
		`
		SELECT artist.id, artist.name, artist.slug, artist.image, artist.id as artist_id, COUNT(gig.id) AS gig_count
		FROM artist
		LEFT JOIN gig ON artist.id = gig.artist_id
		WHERE gig.type = ?${periodClause}
		GROUP BY artist.id, artist.name, artist.slug, artist.image
		ORDER BY gig_count DESC;
		`,
		[type, ...geo.params]
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
		[type, ...geo.params]
	);
	const data = {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival
	};
	return data;
}

async function userGigDashboard(type, userId, period = null, geography = {}) {
	const geo = geographyFilter(geography);
	const periodClause = buildPeriodClause(period, "gig.date", { includeNullOnPast: true }) + geo.clause;
	const total_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT gig.id) AS total_gigs
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		`,
		[userId, type, ...geo.params]
	);
	const summaryTotals = await db.query(
		`
		SELECT
			COUNT(DISTINCT gig.artist_id) AS total_artists,
			COUNT(DISTINCT edition.id) AS total_editions,
			COUNT(DISTINCT event_gig.event_id) AS total_events
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		LEFT JOIN event_gig ON event_gig.gig_id = gig.id
		LEFT JOIN edition_event ON edition_event.event_id = event_gig.event_id
		LEFT JOIN edition ON edition.id = edition_event.edition_id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		`,
		[userId, type, ...geo.params]
	);
	const upcoming_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT gig.id) AS upcoming_gigs
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ? AND ${upcomingGig()}${geo.clause}
		`,
		[userId, type, ...geo.params]
	);
	const gigs_by_year = await db.query(
		`
		SELECT YEAR(COALESCE(gig.date, ${editionDate()})) AS year, COUNT(DISTINCT gig.id) AS gig_count
		FROM user_gig
		INNER JOIN gig ON user_gig.gig_id = gig.id
		WHERE user_gig.user_id = ? AND user_gig.status = 'going' AND gig.type = ?${periodClause}
		GROUP BY year
		ORDER BY year
		`,
		[userId, type, ...geo.params]
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
		[userId, type, ...geo.params]
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
		[userId, type, ...geo.params]
	);

	return {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival,
		summary: {
			total_artists: Number(summaryTotals?.[0]?.total_artists || 0),
			total_editions: Number(summaryTotals?.[0]?.total_editions || 0),
			total_events: Number(summaryTotals?.[0]?.total_events || 0),
			upcoming_gigs: Number(upcoming_gigs?.[0]?.upcoming_gigs || 0)
		}
	};
}

async function userEventDashboard(type, userId, period = null, geography = {}) {
	const countedStatuses = ["going", "attended"];
	const geo = geographyFilter(geography, "event.city_id");
	const periodClause = buildPeriodClause(period, "event.date") + geo.clause;
	const total_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT event.id) AS total_gigs
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		`,
		[userId, ...countedStatuses, type, ...geo.params]
	);
	const gigs_by_year = await db.query(
		`
		SELECT YEAR(COALESCE(event.date, ${eventEditionDate()})) AS year, COUNT(DISTINCT event.id) AS gig_count
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		GROUP BY year
		ORDER BY year
		`,
		[userId, ...countedStatuses, type, ...geo.params]
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
		[userId, ...countedStatuses, type, ...geo.params]
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
		[userId, ...countedStatuses, type, ...geo.params]
	);
	const total_artists = await db.query(
		`
		SELECT COUNT(DISTINCT artist.id) AS total_artists
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		INNER JOIN event_gig ON event_gig.event_id = event.id
		INNER JOIN gig ON gig.id = event_gig.gig_id
		INNER JOIN artist ON artist.id = gig.artist_id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ?${periodClause}
		`,
		[userId, ...countedStatuses, type, ...geo.params]
	);
	const upcoming_gigs = await db.query(
		`
		SELECT COUNT(DISTINCT event.id) AS upcoming_gigs
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		WHERE user_event.user_id = ? AND user_event.status IN (?, ?) AND event.type = ? AND ${upcomingEvent()}${geo.clause}
		`,
		[userId, ...countedStatuses, type, ...geo.params]
	);

	return {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival,
		summary: {
			total_artists: Number(total_artists?.[0]?.total_artists || 0),
			total_editions: 0,
			total_events: Number(total_gigs?.[0]?.total_gigs || 0),
			upcoming_gigs: Number(upcoming_gigs?.[0]?.upcoming_gigs || 0)
		}
	};
}

async function create(gigs) {
	return db.transaction(async (query) => {
		for (const [index, gig] of gigs.entries()) {
			let venueId = normalizeNumber(gig.venue_id || gig.venue?.id);
			let aliasId = selectedAlias(gig);
			if (!venueId) {
				const cityName = typeof gig.city === "string" ? normalizeCityName(gig.city, gig.country_code) : null;
				let cityId = normalizeNumber(gig.city_id || gig.city?.id);
				if (!cityId && cityName) {
					if (gig.country_code) {
						cityId = (await require('./city').ensureCity({name:cityName,country_code:gig.country_code,state:gig.state,municipality:gig.municipality},query)).id;
					} else {
						const cities = await query(`SELECT id FROM city WHERE name = ? LIMIT 2`, [cityName]);
						if (cities.length !== 1) throw Object.assign(new Error('Seleciona a cidade e o país do concerto.'), {statusCode:400});
						cityId = cities[0].id;
					}
				}
				const venueName = typeof gig.venue === "string" ? gig.venue.trim() : gig.venue?.name;
				if (!venueName) throw Object.assign(new Error("Indica o local do concerto."), { statusCode: 400 });
				assertPhysicalVenueName(venueName);
				const match = cityId ? await findVenueByName(venueName, cityId, query) : null;
				const venues = match ? [match] : await query(`SELECT id FROM venue WHERE name = ?${cityId ? " AND city_id = ?" : ""} FOR UPDATE`, cityId ? [venueName, cityId] : [venueName]);
				if (match && aliasId === undefined) aliasId = match.alias_id;
				if (venues.length > 1 || (!venues.length && !cityId)) {
					throw Object.assign(new Error("Seleciona um local com cidade definida."), { statusCode: 400 });
				}
				venueId = venues[0]?.id || (await query(`INSERT INTO venue (name, city_id) VALUES (?, ?)`, [venueName, cityId])).insertId;
			}
			const selectedVenue = await selectVenue(venueId, aliasId, query);
			venueId = selectedVenue.id;
			const cityId = selectedVenue.city_id;
			const artists = await query(`SELECT id FROM artist WHERE name = ?`, [gig.artist]);
			const artistId = artists[0]?.id || (await query(`INSERT INTO artist (name) VALUES (?)`, [gig.artist])).insertId;
			let date = null;
			if (gig.date && gig.date !== "*") {
				const [day, month, year] = gig.date.split("-");
				date = `${year}-${month}-${day}`;
			}
			await query(`INSERT INTO gig (artist_id, venue_id, city_id, position, date, venue_alias_id) VALUES (?, ?, ?, ?, ?, ?)`, [artistId, venueId, cityId, index, date, selectedVenue.alias_id]);
		}
		return { message: "finished" };
	});
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
	return db.transaction(async (query) => {
		const gigId = normalizeNumber(id);
		if (!gigId) {
			throw new Error("Gig inválido");
		}

		const currentRows = await query(`SELECT id, date, start_time, end_time, artist_id, venue_id, venue_alias_id, city_id FROM gig WHERE id = ? FOR UPDATE`, [gigId]);
		if (!currentRows.length) {
			throw new Error("Gig não encontrado");
		}

		const linkedEditionIds = await getEditionIdsForGig(gigId, query);
		const nextArtistId = hasOwn(gig, "artist_id") ? normalizeNumber(gig.artist_id) : undefined;
		const nextVenueId = hasOwn(gig, "venue_id") ? normalizeNumber(gig.venue_id) : undefined;
		const inputVenueId = nextVenueId === undefined ? currentRows[0].venue_id : nextVenueId;
		const requestedAlias = selectedAlias(gig);
		const aliasId = requestedAlias === undefined && inputVenueId === Number(currentRows[0].venue_id) ? currentRows[0].venue_alias_id : requestedAlias;
		const selectedVenue = await selectVenue(inputVenueId, aliasId, query);
		const nextCityId = selectedVenue.city_id;
		const nextDate = hasOwn(gig, "date") ? normalizeDate(gig.date) : undefined;
		const nextStartTime = hasOwn(gig, "start_time") ? normalizeTime(gig.start_time) : undefined;
		const nextEndTime = hasOwn(gig, "end_time") ? normalizeTime(gig.end_time) : undefined;
		const nextStageName = hasOwn(gig, "stage_name") ? normalizeStageName(gig.stage_name) : undefined;
		const providedEventId = hasOwn(gig, "event_id") ? normalizeNumber(gig.event_id) : null;

		if (hasOwn(gig, "artist_id") && !nextArtistId) {
			throw new Error("Artista inválido.");
		}
		if (hasOwn(gig, "venue_id") && !nextVenueId) {
			throw new Error("Venue inválido.");
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
			const artistRows = await query(`SELECT id FROM artist WHERE id = ? LIMIT 1`, [nextArtistId]);
			if (!artistRows.length) {
				throw new Error("Artista não encontrado.");
			}
		}
		if (nextCityId) {
			const cityRows = await query(`SELECT id FROM city WHERE id = ? LIMIT 1`, [nextCityId]);
			if (!cityRows.length) {
				throw new Error("Cidade não encontrada.");
			}
		}

		let affectedRows = 0;
		const gigFields = [];
		const gigParams = [];

		if (hasOwn(gig, "artist_id")) {
			gigFields.push("artist_id = ?");
			gigParams.push(nextArtistId);
		}
		if (hasOwn(gig, "venue_id") || requestedAlias !== undefined) {
			gigFields.push("venue_id = ?", "venue_alias_id = ?");
			gigParams.push(selectedVenue.id, selectedVenue.alias_id);
		}
		if (nextCityId) {
			gigFields.push("city_id = ?");
			gigParams.push(nextCityId);
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
			const updateResult = await query(`UPDATE gig SET ${gigFields.join(", ")} WHERE id = ?`, [...gigParams, gigId]);
			affectedRows += Number(updateResult.affectedRows || 0);
		}
		if (hasOwn(gig, "artist_id")) {
			const setlistUpdate = await query(`UPDATE setlist SET artist_id = ? WHERE gig_id = ?`, [nextArtistId, gigId]);
			affectedRows += Number(setlistUpdate.affectedRows || 0);
		}

		if (hasOwn(gig, "date") && linkedEditionIds.length) {
			if (linkedEditionIds.length !== 1) throw Object.assign(new Error("Este concerto pertence a várias edições. Revê as associações antes de alterar o dia."), { statusCode: 409 });
			const edition = await festivalProgram.loadEdition(linkedEditionIds[0], query, true);
			await festivalProgram.placeFestivalGig(query, edition, gigId, nextDate, {
				stage_name: hasOwn(gig, "stage_name") ? nextStageName : undefined,
				start_time: hasOwn(gig, "start_time") ? nextStartTime : undefined,
				end_time: hasOwn(gig, "end_time") ? nextEndTime : undefined
			});
			await syncEditionDatesForEditionIds(linkedEditionIds, query);
			return { message: "Concerto atualizado sem alterar as marcações." };
		}

		const shouldUpdateEventGig =
			hasOwn(gig, "event_id") ||
			hasOwn(gig, "stage_name") ||
			hasOwn(gig, "stage_id") ||
			hasOwn(gig, "start_time") ||
			hasOwn(gig, "end_time");

		if (shouldUpdateEventGig) {
			const eventGigRows = await query(`SELECT event_id, stage_id, start_time, end_time FROM event_gig WHERE gig_id = ?`, [gigId]);
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
					const stageId = hasOwn(gig, "stage_name") || hasOwn(gig, "stage_id") ? await resolveStageId(eventId, gig.stage_id, nextStageName, query) : row.stage_id;
					if (stageId === undefined) {
						throw new Error("Palco inválido.");
					}

					const eventStartTime = hasOwn(gig, "start_time") ? nextStartTime : row.start_time;
					const eventEndTime = hasOwn(gig, "end_time") ? nextEndTime : row.end_time;
					const result = await query(`UPDATE event_gig SET stage_id = ?, start_time = ?, end_time = ? WHERE event_id = ? AND gig_id = ?`, [stageId, eventStartTime, eventEndTime, eventId, gigId]);
					affectedRows += Number(result.affectedRows || 0);
				}
			}
		}

		if (!affectedRows) {
			return { message: "No changes" };
		}

		await syncEditionDatesForEditionIds(linkedEditionIds, query);

		return { message: "gig updated successfully" };
	}, { lockName: "festival-program" });
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

async function getLatestMedia(type = "1", geography = {}) {
	if (!["1", "2"].includes(String(type))) {
		const error = new Error("Tipo de espetáculo inválido.");
		error.statusCode = 400;
		throw error;
	}

	const geo = geographyFilter(geography, "g.city_id");
	const latest = (mediaType, limit) => db.query(
		`SELECT gm.id, gm.url, gm.user_id, u.name AS user_name,
		        g.id AS gig_id, g.date, a.name AS artist, COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id = g.venue_alias_id AND vn.venue_id = v.id), v.name) AS venue
		 FROM gig_media gm
		 INNER JOIN gig g ON g.id = gm.gig_id
		 INNER JOIN artist a ON a.id = g.artist_id
		 INNER JOIN venue v ON v.id = g.venue_id
		 LEFT JOIN user u ON u.id = gm.user_id
		 WHERE gm.type = ? AND g.type = ?${geo.clause}
		 ORDER BY gm.id DESC LIMIT ${limit}`,
		[mediaType, Number(type), ...geo.params]
	);
	const [photos, reviews] = await Promise.all([latest("image", 8), latest("link", 4)]);
	return { photos, reviews };
}

async function getReviewPreview(gigId, reviewId) {
	const rows = await db.query(`SELECT url FROM gig_media WHERE gig_id = ? AND id = ? AND type = 'link' LIMIT 1`, [gigId, reviewId]);
	if (!rows.length) {
		const error = new Error("Review não encontrada.");
		error.statusCode = 404;
		throw error;
	}
	return reviewPreview.getPreview(rows[0].url);
}

async function getMyPhotos(userId, page = 1) {
	return getUserPhotos(userId, page);
}

async function addMedia(gigId, body, userId) {
	const { url, type } = body;

	if (!userId) {
		const error = new Error("É necessário iniciar sessão para adicionar fotografias.");
		error.statusCode = 401;
		throw error;
	}

	if (typeof url !== "string" || !["image", "video", "link"].includes(type) || !/^https?:\/\/\S+$/i.test(url.trim())) {
		const error = new Error("Indica um URL válido e um tipo de conteúdo válido.");
		error.statusCode = 400;
		throw error;
	}
	if (type === "link") {
		try {
			reviewPreview.normalizeUrl(url.trim());
		} catch {
			const error = new Error("Indica um link público válido para a review.");
			error.statusCode = 400;
			throw error;
		}
	}

	const gigs = await db.query(`SELECT id FROM gig WHERE id = ? LIMIT 1`, [gigId]);
	if (!gigs.length) {
		const error = new Error("Concerto não encontrado.");
		error.statusCode = 404;
		throw error;
	}

	await db.query(`INSERT INTO gig_media (gig_id, url, type, user_id) VALUES (?, ?, ?, ?)`, [gigId, url.trim(), type, userId]);

	return { success: true };
}

async function updateMedia(gigId, mediaId, body, userId) {
	const { url, type } = body;

	const result = await db.query(
		`UPDATE gig_media SET url=?, type=?, user_id=COALESCE(user_id, ?) WHERE id=? AND gig_id=?`,
		[url, type, userId, mediaId, gigId]
	);

	if (result.affectedRows === 0) {
		throw new Error("Media não encontrado");
	}

	return { success: true };
}

async function deleteMedia(gigId, mediaId, user) {
	if (!user?.id) {
		throw Object.assign(new Error("Inicia sessão para apagar fotografias e reviews."), { statusCode: 401 });
	}
	const gigIdentifier = Number(gigId);
	const mediaIdentifier = Number(mediaId);
	if (![gigIdentifier, mediaIdentifier].every(id => Number.isSafeInteger(id) && id > 0)) {
		throw Object.assign(new Error("Identificador inválido."), { statusCode: 400 });
	}

	return db.transaction(async (query) => {
		const rows = await query(`SELECT user_id, type FROM gig_media WHERE id = ? AND gig_id = ? FOR UPDATE`, [mediaIdentifier, gigIdentifier]);
		if (!rows.length) {
			throw Object.assign(new Error("Conteúdo não encontrado."), { statusCode: 404 });
		}
		const media = rows[0];
		if (user.role !== "admin" && (Number(media.user_id) !== Number(user.id) || !["image", "link"].includes(media.type))) {
			throw Object.assign(new Error("Só podes apagar as fotografias e reviews que adicionaste."), { statusCode: 403 });
		}
		await query(`DELETE FROM gig_media WHERE id = ? AND gig_id = ?`, [mediaIdentifier, gigIdentifier]);
		return { success: true };
	});
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
	getMyPhotos,
	getLatestMedia,
	getReviewPreview,
	addMedia,
	updateMedia,
	deleteMedia
};
