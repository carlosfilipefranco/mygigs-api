const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	console.log(page, search);
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(artist.name) LIKE '%${search}%' OR LOWER(venue.name) LIKE '%${search}%' OR LOWER(city.name) LIKE '%${search}%' OR LOWER(gig.date) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT gig.id, gig.date, artist.name as artist, artist.image, venue.name as venue, city.name as city FROM gig INNER JOIN artist ON gig.artist_id = artist.id INNER JOIN venue ON gig.venue_id = venue.id INNER JOIN city ON gig.city_id = city.id ${searchQuery} ORDER by gig.date DESC, gig.position LIMIT ${offset},${config.listPerPage}`);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM gig`);
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
	const result = await db.query(`SELECT gig.id, gig.date, artist.name as artist, artist.image, artist.id as artist_id, venue.name as venue, city.name as city FROM gig INNER JOIN artist ON gig.artist_id = artist.id INNER JOIN venue ON gig.venue_id = venue.id INNER JOIN city ON gig.city_id = city.id WHERE gig.id=${id}`);
	return result[0];
}

async function dashboard() {
	const total_gigs = await db.query(`SELECT COUNT(*) AS total_gigs FROM gig`);
	const gigs_by_year = await db.query(`SELECT YEAR(date) AS year, COUNT(*) AS gig_count FROM gig GROUP BY YEAR(date) ORDER BY YEAR(date);`);
	const gigs_by_artist = await db.query(`SELECT artist.id, artist.name, artist.image, artist.id as artist_id, COUNT(gig.id) AS gig_count FROM artist LEFT JOIN gig ON artist.id = gig.artist_id GROUP BY artist.id, artist.name ORDER BY gig_count DESC;`);
	const data = {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist
	};
	return data;
}

async function create(gigs) {
	gigs.forEach(async (gig, index) => {
		var artist = await db.query(`SELECT id FROM artist WHERE name="${gig.artist}"`);
		if (!artist.length) {
			artist = await db.query(`INSERT INTO artist (name)  VALUES  ("${gig.artist}")`);
		}
		var city = await db.query(`SELECT id FROM city WHERE name="${gig.city}"`);
		if (!city.length) {
			city = await db.query(`INSERT INTO city (name)  VALUES  ("${gig.city}")`);
		}
		var venue = await db.query(`SELECT id FROM venue WHERE name="${gig.venue}"`);
		if (!venue.length) {
			venue = await db.query(`INSERT INTO venue (name)  VALUES  ("${gig.venue}")`);
		}
		let insert = `INSERT INTO gig (artist_id, venue_id, city_id)  VALUES  ("${artist[0].id}", "${venue[0].id}", "${city[0].id}")`;
		var date = null;
		if (gig.date && gig.date != "*") {
			var dateParts = gig.date.split("-");
			var dateObject = new Date(+dateParts[2], dateParts[1] - 1, +dateParts[0]);
			date = new Date(dateObject).toISOString().split("T")[0];
			insert = `INSERT INTO gig (artist_id, venue_id, city_id, position, date)  VALUES  ("${artist[0].id}", "${venue[0].id}", "${city[0].id}", "${index}", "${date}")`;
		}
		const result = await db.query(insert);

		// if (result.affectedRows) {
		// 	message = "gig created successfully";
		// }
	});

	let message = "finished";

	return { message };
}

async function update(id, gig) {
	const rows = await db.query(`SELECT id FROM city WHERE name="${gig.city}"`);
	console.log(rows);
	var result;
	if (rows.length) {
		result = await db.query(`UPDATE gig SET city_id="${rows[0].id}" WHERE id="${id}"`);
	}

	let message = "Error in updating gig";

	if (result.affectedRows) {
		message = "gig updated successfully";
	}

	console.log(id, gig.city);
	console.log(result);

	return { message };
}

async function remove(id) {
	const result = await db.query(`DELETE FROM gig WHERE id=${id}`);

	let message = "Error in deleting gig";

	if (result.affectedRows) {
		message = "gig deleted successfully";
	}

	return { message };
}

async function clean() {
	const result = await db.query(`TRUNCATE TABLE gig`);

	let message = "Error in cleaning gigs";

	if (result.affectedRows) {
		message = "Gig has been cleaned";
	}

	return { message };
}

module.exports = {
	getMultiple,
	get,
	create,
	update,
	remove,
	clean,
	dashboard
};
