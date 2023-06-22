const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(festival.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT festival.id, festival.name, festival.image FROM festival ${searchQuery} ORDER by name LIMIT ${offset},${config.listPerPage}`);

	// createEditions(rows);

	// populateEditionEvent();

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM festival`);
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
	const festival = await db.query(`SELECT festival.id, festival.name, festival.image FROM festival WHERE festival.id = ${id}`);
	const editions = await db.query(`SELECT festival.id, festival.name, edition.id AS edition_id, edition.name AS edition_name FROM festival JOIN edition ON festival.id = edition.festival_id WHERE festival.id = ${id} ORDER by date_start`);

	return {
		festival: festival[0],
		editions
	};
}

async function getEdition(editionId) {
	try {
		const edition = await db.query(`
		  SELECT e.date_start, e.date_end, e.name AS edition_name, v.name AS venue, c.name AS city
		  FROM edition e
		  INNER JOIN venue v ON e.venue_id = v.id
		  INNER JOIN city c ON e.city_id = c.id
		  WHERE e.id = ${editionId}
		`);

		const gigs = await db.query(`
		  SELECT g.id, a.name AS artist, a.image, v.name AS venue
		  FROM gig g
		  INNER JOIN artist a ON g.artist_id = a.id
		  INNER JOIN venue v ON g.venue_id = v.id
		  INNER JOIN event_gig eg ON g.id = eg.gig_id
		  INNER JOIN event ev ON eg.event_id = ev.id
		  INNER JOIN edition_event ee ON ev.id = ee.event_id
		  WHERE ee.edition_id = ${editionId}
		  ORDER BY ev.date
		`);

		return {
			edition: edition[0],
			gigs: gigs
		};
	} catch (error) {
		console.error("Ocorreu um erro ao obter os gigs por edition:", error);
		throw error;
	}
}

async function createEditions(rows) {
	for (const festival of rows) {
		const venues = await db.query(`SELECT id FROM venue WHERE name = '${festival.name}'`);
		for (const venue of venues) {
			const gigs = await db.query(`SELECT gig.id, gig.date, gig.venue_id, gig.city_id FROM gig WHERE venue_id=${venue.id} ORDER BY gig.date`);

			let currentYear = null;
			let date_start = null;
			let date_end = null;

			for (const gig of gigs) {
				const gigYear = new Date(gig.date).getFullYear();

				if (currentYear !== gigYear) {
					if (currentYear) {
						await db.query(`INSERT INTO edition (festival_id, name, venue_id, city_id, date_start, date_end) VALUES (${festival.id}, '${festival.name} ${currentYear}', ${venue.id}, ${gig.city_id}, '${date_start}', '${date_end}')`);
					}

					currentYear = gigYear;
					date_start = new Date(gig.date).toISOString().slice(0, 19).replace("T", " ");
					date_end = new Date(gig.date).toISOString().slice(0, 19).replace("T", " ");
				} else {
					date_end = new Date(gig.date).toISOString().slice(0, 19).replace("T", " ");
				}
			}

			if (currentYear) {
				await db.query(`INSERT INTO edition (festival_id, name, venue_id, city_id, date_start, date_end) VALUES (${festival.id}, '${festival.name} ${currentYear}', ${venue.id}, ${gigs[0].city_id}, '${date_start}', '${date_end}')`);
			}
		}
	}
}

async function populateEditionEvent() {
	const editions = await db.query(`SELECT id, date_start, date_end, venue_id FROM edition`);

	for (const edition of editions) {
		const { id: editionId, date_start: editionStart, date_end: editionEnd } = edition;

		const events = await db.query(`SELECT id, date FROM event WHERE venue_id = ${edition.venue_id}`);

		for (const event of events) {
			const { id: eventId, date } = event;
			const eventDate = new Date(date);
			const start = new Date(editionStart);
			const end = new Date(editionEnd);

			if (eventDate >= start && eventDate <= end) {
				await db.query(`INSERT INTO edition_event (edition_id, event_id) VALUES (${editionId}, ${eventId})`);
			}
		}
	}
}

module.exports = {
	getMultiple,
	get,
	getEdition
};
