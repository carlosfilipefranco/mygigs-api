const db = require("./db");
const { catalogFilter, gigDates } = require("./catalogFilters");

// Os links continuam nos concertos. As listagens e o evento apresentam cada artigo uma vez.
async function getReviews({ type = 1, geography = {}, eventId = null, mediaId = null,
	search = "", limit = 21, offset = 0, recent = false } = {}) {
	if (![1, 2].includes(Number(type))) throw Object.assign(new Error("Tipo de espetáculo inválido."), { statusCode: 400 });
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Paginação inválida.");
	const geo = catalogFilter(geography, "g.city_id", ...gigDates("g"));
	const filters = ["gm.type = 'link'", "g.type = ?"];
	const params = [Number(type)];
	if (eventId !== null) { filters.push("e.id = ?"); params.push(eventId); }
	if (mediaId !== null) { filters.push("gm.id = ?"); params.push(mediaId); }
	if (search) {
		filters.push("(a.name LIKE ? OR ha.name LIKE ? OR e.name LIKE ? OR v.name LIKE ? OR c.name LIKE ? OR gm.url LIKE ? OR u.name LIKE ?)");
		params.push(...Array(7).fill(`%${search}%`));
	}
	params.push(...geo.params);
	// Retirar apenas tracking; os parâmetros que identificam artigos diferentes são preservados.
	const cleanUrl = "TRIM(SUBSTRING_INDEX(gm.url, '#', 1))";
	const withoutTracking = `REGEXP_REPLACE(${cleanUrl}, '([?&])(utm_[^=&]+|fbclid|gclid)=[^&#]*', '$1')`;
	const separators = `REGEXP_REPLACE(REPLACE(REGEXP_REPLACE(${withoutTracking}, '&+', '&'), '?&', '?'), '[?&]+$', '')`;
	const articleKey = `REGEXP_REPLACE(REGEXP_REPLACE(${separators}, '^https?://(www[.])?', ''), '^([^?]*?)/+([?]|$)', '$1$2') COLLATE utf8mb4_bin`;
	return db.query(`WITH candidates AS (
		SELECT gm.id, gm.url, gm.gig_id, u.public_id AS user_public_id, u.name AS user_name,
			COALESCE(hg.id, g.id) AS reference_gig_id, DATE_FORMAT(COALESCE(hg.date, g.date), '%Y-%m-%d') AS date,
			COALESCE(ha.name, a.name) AS artist, COALESCE(ha.image, a.image) AS artist_image,
			e.id AS event_id, e.name AS event_name, e.slug AS event_slug,
			COALESCE((SELECT va.name FROM venue_alias va WHERE va.id = COALESCE(hg.venue_alias_id, g.venue_alias_id) AND va.venue_id = v.id), v.name) AS venue,
			c.name AS city, ${articleKey} AS article_key,
			CASE WHEN hg.id = g.id THEN 0 ELSE 1 END AS headliner_priority, g.position
		FROM gig_media gm
		INNER JOIN gig g ON g.id = gm.gig_id
		INNER JOIN artist a ON a.id = g.artist_id
		LEFT JOIN event_gig eg ON eg.gig_id = g.id
		LEFT JOIN event e ON e.id = eg.event_id
		LEFT JOIN gig hg ON hg.id = (SELECT MIN(heg.gig_id) FROM event_gig heg
			INNER JOIN gig h ON h.id = heg.gig_id WHERE heg.event_id = e.id AND h.artist_id = e.headliner_artist_id)
		LEFT JOIN artist ha ON ha.id = hg.artist_id
		INNER JOIN venue v ON v.id = COALESCE(hg.venue_id, g.venue_id)
		LEFT JOIN city c ON c.id = COALESCE(hg.city_id, g.city_id)
		LEFT JOIN user u ON u.id = gm.user_id
		WHERE ${filters.join(" AND ")}${geo.clause}
	), ranked AS (
		SELECT candidates.*, ROW_NUMBER() OVER (PARTITION BY article_key
			ORDER BY headliner_priority, position, id, event_id) AS article_rank,
			MAX(id) OVER (PARTITION BY article_key) AS latest_media_id
		FROM candidates
	)
	SELECT id, url, gig_id, reference_gig_id, user_public_id, user_name, date, artist, artist_image,
		event_id, event_name, event_slug, venue, city
	FROM ranked WHERE article_rank = 1
	ORDER BY ${recent ? "latest_media_id DESC, id DESC" : "date DESC, reference_gig_id DESC, id DESC"}
	LIMIT ${limit} OFFSET ${offset}`, params);
}

module.exports = { getReviews };
