const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null, favorite = null, type = 1) {
	console.log(page, search);
	const offset = helper.getOffset(page, config.listPerPage);

	let searchQuery = `WHERE gig.type=${type}`;
	if (search) {
		searchQuery = `WHERE gig.type=${type} AND (LOWER(artist.name) LIKE '%${search}%' OR LOWER(venue.name) LIKE '%${search}%' OR LOWER(city.name) LIKE '%${search}%' OR LOWER(gig.date) LIKE '%${search}%')`;
	}
	if (favorite) {
		searchQuery += ` AND gig.favorite = 1`;
	}

	const rows = await db.query(`
		SELECT
			gig.id,
			gig.date,
			gig.favorite,
			artist.name as artist,
			artist.image,
			venue.name as venue,
			city.name as city,
			CASE WHEN setlist.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_setlist
		FROM gig
		INNER JOIN artist ON gig.artist_id = artist.id
		INNER JOIN venue ON gig.venue_id = venue.id
		INNER JOIN city ON gig.city_id = city.id
		LEFT JOIN setlist ON setlist.gig_id = gig.id
		${searchQuery}
		ORDER BY gig.date DESC, gig.position
		LIMIT ${offset},${config.listPerPage}
	`);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM gig WHERE gig.type=${type}`);
		count = row[0].count;
	}
	if (favorite) {
		let row = await db.query(`SELECT COUNT(*) as count FROM gig WHERE favorite = 1 AND gig.type=${type}`);
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
	const result = await db.query(
		`
        SELECT 
            gig.id, 
            gig.date, 
            artist.name AS artist, 
            artist.image, 
            artist.id AS artist_id, 
            venue.name AS venue,
            venue.id AS venue_id,
            city.name AS city,
            festival.id AS festival_id, 
            festival.name AS festival_name,
            edition.id AS edition_id,
            edition.name AS edition_name
        FROM gig 
        INNER JOIN artist ON gig.artist_id = artist.id 
        INNER JOIN venue ON gig.venue_id = venue.id 
        INNER JOIN city ON gig.city_id = city.id 
        LEFT JOIN event_gig eg ON gig.id = eg.gig_id
        LEFT JOIN edition_event ee ON eg.event_id = ee.event_id
        LEFT JOIN edition ON ee.edition_id = edition.id
        LEFT JOIN festival ON edition.festival_id = festival.id
        WHERE gig.id = ?
    `,
		[id]
	);

	if (result.length === 0) return null;

	const gig = result[0];

	// 🔥 Buscar media (imagens, videos, links)
	const mediaRows = await db.query(`SELECT url, type FROM gig_media WHERE gig_id = ?`, [id]);

	gig.images = mediaRows.filter((m) => m.type === "image").map((m) => m.url);
	gig.videos = mediaRows.filter((m) => m.type === "video").map((m) => m.url);
	gig.links = mediaRows.filter((m) => m.type === "link").map((m) => m.url);

	// Procurar setlist local
	const setlistRows = await db.query(
		`
			SELECT 
				s.id AS setlist_id, 
				ss.song_id, 
				ss.position, 
				ss.encore,
				song.name AS song_name
			FROM setlist s
			JOIN setlist_song ss ON ss.setlist_id = s.id
			JOIN song ON ss.song_id = song.id
			WHERE s.gig_id = ?
			ORDER BY ss.encore IS NULL, ss.encore, ss.position
		`,
		[id]
	);

	if (setlistRows.length > 0) {
		const setsMap = new Map();

		for (const row of setlistRows) {
			const key = row.encore ?? 0;
			if (!setsMap.has(key)) {
				setsMap.set(key, []);
			}
			setsMap.get(key).push({ name: row.song_name });
		}

		const orderedKeys = Array.from(setsMap.keys()).sort((a, b) => a - b);

		const sets = orderedKeys.map((encore) => ({
			...(encore > 0 ? { encore } : {}),
			song: setsMap.get(encore).map((s, i) => ({ ...s, number: i + 1 }))
		}));

		gig.setlist = {
			sets: {
				set: sets
			}
		};
	}

	return gig;
}

async function dashboard(type = 1) {
	const total_gigs = await db.query(`SELECT COUNT(*) AS total_gigs FROM gig WHERE type = ${type}`);
	const gigs_by_year = await db.query(`SELECT YEAR(date) AS year, COUNT(*) AS gig_count FROM gig WHERE type = ${type} GROUP BY YEAR(date) ORDER BY YEAR(date);`);
	const gigs_by_artist = await db.query(`SELECT artist.id, artist.name, artist.image, artist.id as artist_id, COUNT(gig.id) AS gig_count FROM artist LEFT JOIN gig ON artist.id = gig.artist_id WHERE gig.type = ${type} GROUP BY artist.id, artist.name ORDER BY gig_count DESC;`);
	const editions_by_festival = await db.query(`
        SELECT 
            festival.id, 
            festival.name, 
            festival.image, 
            COUNT(edition.id) AS edition_count,
            IFNULL(SUM(event_count), 0) AS total_events
        FROM 
            festival 
        LEFT JOIN 
            edition ON festival.id = edition.festival_id 
        LEFT JOIN (
            SELECT 
                edition_id, 
                COUNT(event_id) AS event_count 
            FROM 
                edition_event 
            GROUP BY 
                edition_id
        ) AS edition_events ON edition.id = edition_events.edition_id
        GROUP BY 
            festival.id, festival.name 
        ORDER BY 
            edition_count DESC;
    `);
	const data = {
		total_gigs: total_gigs[0],
		gigs_by_year,
		gigs_by_artist,
		editions_by_festival
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

async function sort(gigs) {
	let result = "";
	gigs.forEach(async (gig) => {
		result = await db.query(`UPDATE gig SET position="${gig.position}" WHERE id="${gig.id}"`);
	});

	let message = "finished";

	return { message };
}

async function images(images) {
	for (const image of images) {
		await db.query(`
            INSERT INTO gig_image (gig_id, url) 
            VALUES ("${image.gig_id}", "${image.url}")
        `);
	}

	let message = "All images inserted successfully";

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

async function favorite(data) {
	let result = await db.query(`UPDATE gig SET favorite="${data.isFavorite}" WHERE id="${data.id}"`);

	let message = "finished";

	return { message };
}

async function addMedia(gigId, body) {
	const { url, type } = body;

	if (!url || !type) {
		throw new Error("url e type são obrigatórios");
	}

	await db.query(`INSERT INTO gig_media (gig_id, url, type) VALUES (?, ?, ?)`, [gigId, url, type]);

	return { success: true };
}

async function updateMedia(gigId, mediaId, body) {
	const { url, type } = body;

	const result = await db.query(`UPDATE gig_media SET url=?, type=? WHERE id=? AND gig_id=?`, [url, type, mediaId, gigId]);

	if (result.affectedRows === 0) {
		throw new Error("Media não encontrado");
	}

	return { success: true };
}

async function deleteMedia(gigId, mediaId) {
	const result = await db.query(`DELETE FROM gig_media WHERE id=? AND gig_id=?`, [mediaId, gigId]);

	if (result.affectedRows === 0) {
		throw new Error("Media não encontrado");
	}

	return { success: true };
}

module.exports = {
	getMultiple,
	get,
	create,
	update,
	remove,
	clean,
	dashboard,
	sort,
	favorite,
	images,
	addMedia,
	updateMedia,
	deleteMedia
};
