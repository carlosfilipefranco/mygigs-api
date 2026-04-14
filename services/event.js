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
		SELECT e.name AS event_name, e.image AS event_image, e.type AS event_type,
		       g.date, g.id AS gig_id, 
		       v.name AS venue, 
		       c.name AS city, 
		       a.id AS artist_id,
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
	const { event_name, event_image, event_type } = result[0];

	// Mapear gigs
	const gigs = result.map((row) => ({
		id: row.gig_id,
		date: row.date,
		venue: row.venue,
		city: row.city,
		artist_id: row.artist_id,
		artist: row.artist,
		artist_image: row.artist_image
	}));

	return {
		name: event_name,
		image: event_image,
		type: event_type,
		gigs
	};
}

async function create(event) {
	const name = event.name || event.artists[event.artists.length - 1].name;
	var resultEvent = await db.query(`INSERT INTO event (name, date, city_id, venue_id, type) VALUES (?, ?, ?, ?, ?)`, [name, event.date, event.city.id, event.venue.id, event.type]);

	for (const artist of event.artists) {
		var resultGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type) VALUES (?, ?, ?, ?, ?)`, [event.date, event.city.id, event.venue.id, artist.id, event.type]);
		await db.query(`INSERT INTO event_gig (event_id, gig_id) VALUES (?, ?)`, [resultEvent.insertId, resultGig.insertId]);
	}

	if (event.edition) {
		await db.query(`INSERT INTO edition_event (edition_id, event_id) VALUES (?, ?)`, [event.edition.edition_id, resultEvent.insertId]);
	}

	let message = "Error in creating Edition";

	if (resultEvent.affectedRows) {
		message = "Event created successfully";
	}

	return { message };
}

async function dashboard(type = 1) {
	const total_events = await db.query(`SELECT COUNT(*) AS total_events FROM event WHERE type = ?`, [type]);
	const events_by_year = await db.query(`SELECT YEAR(date) AS year, COUNT(*) AS event_count FROM event WHERE type = ? GROUP BY YEAR(date) ORDER BY YEAR(date);`, [type]);

	return {
		total_events: total_events[0],
		events_by_year
	};
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

async function update(id, event) {
	const result = await db.query(`UPDATE event SET name=?, image=? WHERE id=?`, [event.name, event.image || null, id]);
	const eventRows = await db.query(`SELECT date, city_id, venue_id, type FROM event WHERE id=?`, [id]);
	let addedArtists = 0;

	if (eventRows.length && Array.isArray(event.artists)) {
		const eventData = eventRows[0];
		const artists = event.artists.filter((artist) => artist && artist.id);

		for (const artist of artists) {
			const existing = await db.query(
				`
				SELECT gig.id
				FROM gig
				INNER JOIN event_gig ON event_gig.gig_id = gig.id
				WHERE event_gig.event_id = ? AND gig.artist_id = ?
				LIMIT 1
				`,
				[id, artist.id]
			);

			if (existing.length) {
				continue;
			}

			const resultGig = await db.query(`INSERT INTO gig (date, city_id, venue_id, artist_id, type) VALUES (?, ?, ?, ?, ?)`, [eventData.date, eventData.city_id, eventData.venue_id, artist.id, eventData.type]);
			await db.query(`INSERT INTO event_gig (event_id, gig_id) VALUES (?, ?)`, [id, resultGig.insertId]);
			addedArtists++;
		}
	}

	let message = "Error in updating Event";

	if (result.affectedRows || addedArtists) {
		message = "Event updated successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	get,
	create,
	remove,
	update,
	dashboard
};
