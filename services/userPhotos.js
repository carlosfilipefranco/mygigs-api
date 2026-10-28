const db = require("./db");

async function getUserPhotos(userId, page = 1, { musicOnly = false } = {}) {
	const pageNumber = Number(page);
	if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) {
		throw Object.assign(new Error("Página inválida."), { statusCode: 400 });
	}
	const limit = 24;
	const offset = (pageNumber - 1) * limit;
	const from = `FROM gig_media gm
		INNER JOIN gig g ON g.id = gm.gig_id
		INNER JOIN artist a ON a.id = g.artist_id
		INNER JOIN venue v ON v.id = g.venue_id
		LEFT JOIN user u ON u.id = gm.user_id
		WHERE gm.type = 'image' AND gm.user_id = ?${musicOnly ? " AND g.type = 1" : ""}`;
	const [rows, totals] = await Promise.all([
		db.query(`SELECT gm.id, gm.url, gm.user_id, u.name AS user_name,
			g.id AS gig_id, g.date, a.name AS artist,
			COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id = g.venue_alias_id AND vn.venue_id = v.id), v.name) AS venue
			${from} ORDER BY gm.id DESC LIMIT ${limit + 1} OFFSET ${offset}`, [userId]),
		db.query(`SELECT COUNT(*) AS total ${from}`, [userId])
	]);
	return { data: rows.slice(0, limit), hasMore: rows.length > limit, page: pageNumber, total: Number(totals[0].total) };
}

module.exports = { getUserPhotos };
