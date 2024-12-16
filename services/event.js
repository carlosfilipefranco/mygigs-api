const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = `WHERE event.type=${type}`;
	if (search) {
		searchQuery = `WHERE LOWER(venue.name) LIKE '%${search}%' OR LOWER(city.name) LIKE '%${search}%' OR LOWER(event.date) LIKE '%${search}% AND event.type=${type}''`;
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

async function create(event) {
	console.log(event);
	var resultEvent = await db.query(`INSERT INTO event (name, date, city_id, venue_id) VALUES ("${event.artists[event.artists.length - 1].name}", "${event.date.split("T")[0]}", "${event.city.id}", "${event.venue.id}")`);

	event.artists.forEach(async (artist) => {
		var resultGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id) VALUES ("${event.date.split("T")[0]}", "${event.city.id}", "${event.venue.id}", "${artist.id}")`);
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
