const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(edition.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT id, name FROM edition ${searchQuery}  LIMIT ${offset},${config.listPerPage}`);
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
		const edition = await db.query(
			`
		  SELECT e.id, e.date_start, e.date_end, e.name AS name, e.image, v.name AS venue, c.name AS city, c.id AS city_id, v.id AS venue_id, festival.image as festival_image
		  FROM edition e
		  LEFT JOIN venue v ON e.venue_id = v.id
		  LEFT JOIN city c ON e.city_id = c.id
      LEFT JOIN festival ON e.festival_id = festival.id
		  WHERE e.id = ?
		`,
			[id]
		);

		if (!edition.length) {
			return {
				edition: null,
				gigs: []
			};
		}

		const userGigSelect = userId ? ", ug.status AS user_gig_status, ug.favorite AS user_gig_favorite" : "";
		const userGigJoin = userId ? "LEFT JOIN user_gig ug ON ug.gig_id = g.id AND ug.user_id = ?" : "";
		const gigsParams = userId ? [userId, id] : [id];
		const gigsRows = await db.query(
			`
		  SELECT g.id, g.date, g.artist_id, a.name AS artist, a.image, v.name AS venue, v.id AS venue_id, c.name AS city, c.id AS city_id,
		         ev.id AS event_id, ev.name AS event_name,
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
		           COALESCE(eg.start_time, g.start_time) ASC,
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

	if (rows.length) {
		const id = rows[0].id;
		result = await db.query(`UPDATE edition SET name="${edition.name}", festival_id="${edition.festival_id}", image="${edition.image}", city_id="${edition.city.id}", venue_id="${edition.venue.id}" WHERE id=${id}`);
	} else {
		result = await db.query(`INSERT INTO edition (name, festival_id, image, city_id, venue_id) VALUES  ("${edition.name}", "${edition.festival_id}", "${edition.image}", "${edition.city.id}", "${edition.venue.id}")`);
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

		if (rows.length) {
			const id = rows[0].id;
			result = await db.query(`UPDATE edition SET name="${edition}" WHERE id=${id}`);
		} else {
			result = await db.query(`INSERT INTO edition (name)  VALUES  ("${edition}")`);
		}
	});

	let message = "Editions created successfully";

	return { message };
}

async function update(id, edition) {
	const result = await db.query(`UPDATE edition SET name="${edition.name}", image="${edition.image}", city_id="${edition.city.id}", venue_id="${edition.venue.id}" WHERE id=${id}`);

	let message = "Error in updating Edition";

	if (result.affectedRows) {
		message = "Edition updated successfully";
	}

	return { message };
}

async function remove(id) {
	const result = await db.query(`DELETE FROM edition WHERE id=${id}`);

	let message = "Error in deleting Edition";

	if (result.affectedRows) {
		message = "Edition deleted successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	create,
	update,
	remove,
	get,
	createBulk
};
