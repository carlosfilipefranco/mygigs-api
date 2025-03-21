const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null, type = 1) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = `WHERE event.type=${type}`;
	if (search) {
		searchQuery = `WHERE event.type=${type} AND (LOWER(event.name) LIKE '%${search}%' OR LOWER(venue.name) LIKE '%${search}%' OR LOWER(city.name) LIKE '%${search}%' OR LOWER(event.date) LIKE '%${search}%')`;
	}
	const rows = await db.query(`SELECT event.id, event.date, event.name, event.image, venue.name as venue, city.name as city FROM event INNER JOIN venue ON event.venue_id = venue.id INNER JOIN city ON event.city_id = city.id ${searchQuery} ORDER by event.date DESC LIMIT ${offset},${config.listPerPage}`);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM event WHERE event.type=${type}`);
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
	const result = await db.query(`
		SELECT e.name AS event_name, e.image AS event_image, 
		       g.date, g.id AS gig_id, 
		       v.name AS venue, 
		       c.name AS city, 
		       a.name AS artist, 
		       a.image AS artist_image
		FROM event e
		INNER JOIN event_gig eg ON e.id = eg.event_id
		INNER JOIN gig g ON eg.gig_id = g.id
		INNER JOIN venue v ON g.venue_id = v.id
		INNER JOIN city c ON g.city_id = c.id
		INNER JOIN artist a ON g.artist_id = a.id
		WHERE e.id = ${id}
	`);

	if (result.length === 0) {
		return null;
	}

	// Pegar os dados do evento (assumindo que são os mesmos para todos os gigs)
	const { event_name, event_image } = result[0];

	// Mapear gigs
	const gigs = result.map((row) => ({
		id: row.gig_id,
		date: row.date,
		venue: row.venue,
		city: row.city,
		artist: row.artist,
		artist_image: row.artist_image
	}));

	return {
		name: event_name,
		image: event_image,
		gigs
	};
}

async function create(event) {
	console.log(event);
	var resultEvent = await db.query(`INSERT INTO event (name, date, city_id, venue_id, type) VALUES ("${event.artists[event.artists.length - 1].name}", "${event.date}", "${event.city.id}", "${event.venue.id}", "${event.type}")`);

	event.artists.forEach(async (artist) => {
		var resultGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type) VALUES ("${event.date}", "${event.city.id}", "${event.venue.id}", "${artist.id}", "${event.type}")`);
		console.log(resultEvent.insertId, resultGig.insertId);
		await db.query(`INSERT INTO event_gig (event_id, gig_id) VALUES ( "${resultEvent.insertId}", "${resultGig.insertId}")`);
		if (event.edition) {
			await db.query(`INSERT INTO edition_event (edition_id, event_id) VALUES ( "${event.edition.edition_id}", "${resultEvent.insertId}")`);
		}
	});

	let message = "Error in creating Edition";

	if (resultEvent.affectedRows) {
		message = "Event created successfully";
	}

	return { message };
}

async function remove(id) {
	await db.query(`DELETE FROM gig WHERE id IN (SELECT gig_id FROM event_gig WHERE event_id = "${id}")`);
	await db.query(`DELETE FROM event_gig WHERE event_id=${id}`);
	await db.query(`DELETE FROM edition_event WHERE event_id=${id}`);

	const result = await db.query(`DELETE FROM event WHERE id=${id}`);

	let message = "Error in deleting Edition";

	if (result.affectedRows) {
		message = "Edition deleted successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	get,
	create,
	remove
};
