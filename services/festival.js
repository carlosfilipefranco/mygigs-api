const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(festival.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT festival.id, festival.name FROM festival ${searchQuery} ORDER by name LIMIT ${offset},${config.listPerPage}`);

	// createEditions(rows);

	// populateEditionEvent(rows);

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
	const result = await db.query(`SELECT festival.id, festival.name, edition.id AS edition_id, edition.name AS edition_name FROM festival JOIN edition ON festival.id = edition.festival_id WHERE festival.id = ${id}`);
	return result;
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
	get
};
