const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(venue.name) LIKE '%${search}%' OR LOWER(city.name) LIKE '%${search}%' OR LOWER(event.date) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT event.id, event.date, event.name, event.image, venue.name as venue, city.name as city FROM event INNER JOIN venue ON event.venue_id = venue.id INNER JOIN city ON event.city_id = city.id ${searchQuery} ORDER by event.date DESC LIMIT ${offset},${config.listPerPage}`);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM event`);
		count = row[0].count;
	}

	const data = helper.emptyOrRows(rows);
	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function get(id) {
	const result = await db.query(`SELECT g.date, g.id as id, v.name AS venue, c.name AS city, a.name AS artist, a.image as image FROM event e INNER JOIN event_gig eg ON e.id = eg.event_id INNER JOIN gig g ON eg.gig_id = g.id INNER JOIN venue v ON g.venue_id = v.id INNER JOIN city c ON g.city_id = c.id INNER JOIN artist a ON g.artist_id = a.id WHERE e.id=${id}`);
	return result;
}

module.exports = {
	getMultiple,
	get
};
