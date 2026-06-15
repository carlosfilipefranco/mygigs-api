const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { resolveEntityIdByIdentifier, buildUniqueSlug } = require("./slug");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(festival.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT festival.id, festival.name, festival.image, festival.slug FROM festival ${searchQuery} ORDER by name LIMIT ${offset},${config.listPerPage}`);

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

async function getUpcomingEditions(page = 1, limit = 8) {
	const pageNumber = Math.max(1, Number(page) || 1);
	const pageSize = Math.min(24, Math.max(1, Number(limit) || 8));
	const offset = helper.getOffset(pageNumber, pageSize);
	const selectClause = `
		SELECT
			festival.id AS festival_id,
			festival.name AS festival_name,
			festival.slug AS festival_slug,
			festival.image AS festival_image,
			edition.id AS edition_id,
			edition.name AS edition_name,
			edition.slug AS edition_slug,
			edition.image AS edition_image,
			edition.date_start,
			edition.date_end,
			venue.name AS venue,
			city.name AS city,
			COUNT(DISTINCT DATE(event.date)) AS total_days
		FROM edition
		INNER JOIN festival ON festival.id = edition.festival_id
		LEFT JOIN venue ON venue.id = edition.venue_id
		LEFT JOIN city ON city.id = edition.city_id
		LEFT JOIN edition_event ON edition_event.edition_id = edition.id
		LEFT JOIN event ON event.id = edition_event.event_id
	`;
	const groupByClause = `
		GROUP BY festival.id, festival.name, festival.slug, festival.image,
		         edition.id, edition.name, edition.slug, edition.image, edition.date_start, edition.date_end,
		         venue.name, city.name
	`;

	const ongoingRows = await db.query(
		`
		${selectClause}
		WHERE edition.date_start IS NOT NULL
		  AND DATE(edition.date_start) <= CURDATE()
		  AND DATE(COALESCE(edition.date_end, edition.date_start)) >= CURDATE()
		${groupByClause}
		ORDER BY DATE(edition.date_start) ASC, edition.name ASC
		LIMIT ${pageSize}
	`
	);
	const upcomingLimit = Math.max(pageSize - ongoingRows.length, Math.ceil(pageSize / 2));
	const upcomingRows = await db.query(
		`
		${selectClause}
		WHERE edition.date_start IS NOT NULL
		  AND DATE(edition.date_start) > CURDATE()
		${groupByClause}
		ORDER BY DATE(edition.date_start) ASC, edition.name ASC
		LIMIT ${offset}, ${upcomingLimit}
	`
	);

	const countRows = await db.query(
		`
		SELECT COUNT(*) AS count
		FROM edition
		WHERE edition.date_start IS NOT NULL
		  AND (
			  DATE(edition.date_start) > CURDATE()
			  OR (
				  DATE(edition.date_start) <= CURDATE()
				  AND DATE(COALESCE(edition.date_end, edition.date_start)) >= CURDATE()
			  )
		  )
		`
	);
	const mapRows = (rows, isOngoing) =>
		helper.emptyOrRows(rows).map((edition) => ({
			...edition,
			total_days: Number(edition.total_days || 0),
			is_ongoing: isOngoing
		}));

	return {
		data: [...mapRows(ongoingRows, true), ...mapRows(upcomingRows, false)],
		meta: { page: pageNumber, count: countRows?.[0]?.count || 0 }
	};
}

async function get(id, userId = null) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "festival", id);
	if (!resolvedId) {
		return { festival: null, editions: [] };
	}

	const festival = await db.query(`SELECT festival.id, festival.name, festival.image, festival.slug FROM festival WHERE festival.id = ?`, [resolvedId]);
	const editionRows = await db.query(
		`
		SELECT festival.id,
		       festival.name,
		       edition.id AS edition_id,
		       edition.name AS edition_name,
		       edition.slug AS edition_slug,
		       edition.date_start,
		       COUNT(DISTINCT DATE(ev.date)) AS total_days,
		       COUNT(DISTINCT CASE WHEN ug.status = 'going' OR ue.status IN ('attended', 'going') THEN DATE(ev.date) END) AS user_attended_days
		FROM festival
		INNER JOIN edition ON festival.id = edition.festival_id
		LEFT JOIN edition_event ee ON ee.edition_id = edition.id
		LEFT JOIN event ev ON ev.id = ee.event_id
		LEFT JOIN event_gig eg ON eg.event_id = ev.id
		LEFT JOIN gig g ON g.id = eg.gig_id
		LEFT JOIN user_gig ug ON ug.gig_id = g.id AND ug.user_id = ?
		LEFT JOIN user_event ue ON ue.event_id = ev.id AND ue.user_id = ?
		WHERE festival.id = ?
		GROUP BY festival.id, festival.name, edition.id, edition.name, edition.slug, edition.date_start
		ORDER BY edition.date_start
	`,
		[userId || 0, userId || 0, resolvedId]
	);
	const editions = editionRows.map((edition) => {
		const userAttendedDays = Number(edition.user_attended_days || 0);

		return {
			...edition,
			total_days: Number(edition.total_days || 0),
			user_attended_days: userAttendedDays,
			user_attended: userAttendedDays > 0
		};
	});

	return {
		festival: festival[0],
		editions
	};
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

async function create(festival) {
	const rows = await db.query(`SELECT id FROM festival WHERE name="${festival.name}"`);
	var result;
	const slug = await buildUniqueSlug(db, "festival", festival?.name, rows?.[0]?.id || null);

	if (rows.length) {
		const id = rows[0].id;
		result = await db.query(`UPDATE festival SET name="${festival.name}", image="${festival.image}", slug="${slug}" WHERE id=${id}`);
	} else {
		result = await db.query(`INSERT INTO festival (name, image, slug) VALUES ("${festival.name}", "${festival.image}", "${slug}")`);
	}

	let message = "Error in creating Festival";

	if (result.affectedRows) {
		message = "Festival created successfully";
	}

	return { message };
}

async function createBulk(festivals) {
	festivals.forEach(async (festival) => {
		const rows = await db.query(`SELECT id FROM festival WHERE name="${festival}"`);
		var result;
		const slug = await buildUniqueSlug(db, "festival", festival, rows?.[0]?.id || null);

		if (rows.length) {
			const id = rows[0].id;
			result = await db.query(`UPDATE festival SET name="${festival}", slug="${slug}" WHERE id=${id}`);
		} else {
			result = await db.query(`INSERT INTO festival (name, slug)  VALUES  ("${festival}", "${slug}")`);
		}
	});

	let message = "Festivals created successfully";

	return { message };
}

async function update(id, festival) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "festival", id);
	if (!resolvedId) {
		return { message: "Festival not found" };
	}

	const slug = await buildUniqueSlug(db, "festival", festival?.name, resolvedId);
	const result = await db.query(`UPDATE festival SET name="${festival.name}", image="${festival.image}", slug="${slug}" WHERE id=${resolvedId}`);

	let message = "Error in updating Festival";

	if (result.affectedRows) {
		message = "Festival updated successfully";
	}

	return { message };
}

async function remove(id) {
	const resolvedId = await resolveEntityIdByIdentifier(db, "festival", id);
	if (!resolvedId) {
		return { message: "Festival not found" };
	}

	const result = await db.query(`DELETE FROM festival WHERE id=${resolvedId}`);

	let message = "Error in deleting Festival";

	if (result.affectedRows) {
		message = "Festival deleted successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	getUpcomingEditions,
	get,
	create,
	update,
	remove,
	createBulk
};
