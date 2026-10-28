const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { validateCityId } = require("./venueCity");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	const searchQuery = search ? "WHERE LOWER(venue.name) LIKE ? OR LOWER(city.name) LIKE ?" : "";
	const params = search ? [`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`] : [];
	const rows = await db.query(`SELECT venue.id, venue.name, venue.city_id, city.name AS city,
		CONCAT(venue.name, COALESCE(CONCAT(' — ', city.name), ' — Cidade por definir')) AS display_name, venue.lat, venue.lng
		FROM venue LEFT JOIN city ON city.id = venue.city_id ${searchQuery} ORDER BY venue.name, city.name LIMIT ${offset},${config.listPerPage}`, params);
	const data = helper.emptyOrRows(rows);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM venue`);
		count = row[0].count;
	}

	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function get(id) {
	const venue = await db.query(`
		SELECT
			venue.id,
			venue.name,
			venue.lat,
			venue.lng,
			city.id AS city_id,
			city.name AS city
		FROM venue
		LEFT JOIN city ON venue.city_id = city.id
		WHERE venue.id = ?
	`, [id]);

	const gigs = await db.query(`
		SELECT
			gig.id,
			gig.date,
			event.id AS event_id,
			event.name AS event_name,
			event.slug AS event_slug,
			artist.name AS artist,
			artist.image,
			artist.id AS artist_id,
			artist.slug AS artist_slug,
			venue.name AS venue,
			city.name AS city
		FROM gig
		INNER JOIN artist ON gig.artist_id = artist.id
		INNER JOIN venue ON gig.venue_id = venue.id
		INNER JOIN city ON gig.city_id = city.id
		LEFT JOIN event_gig ON event_gig.gig_id = gig.id
		LEFT JOIN event ON event.id = event_gig.event_id
		WHERE venue.id = ?
		ORDER BY gig.date
	`, [id]);

	return {
		gigs,
		venue: venue[0]
	};
}

async function create(venue) {
	return db.transaction(async (query) => {
		const cityId = await validateCityId(venue.city_id || venue.city, query);
		const name = venue.name?.trim();
		if (!name) throw Object.assign(new Error("Indica o nome do local."), { statusCode: 400 });
		const rows = await query(`SELECT id FROM venue WHERE name = ? AND city_id = ? FOR UPDATE`, [name, cityId]);
		const lat = normalizeCoordinate(venue.lat);
		const lng = normalizeCoordinate(venue.lng);
		if (rows.length) {
			await query(`UPDATE venue SET lat = COALESCE(?, lat), lng = COALESCE(?, lng) WHERE id = ?`, [lat, lng, rows[0].id]);
			return { id: rows[0].id, message: "Venue already exists in this city" };
		}
		const result = await query(`INSERT INTO venue (name, city_id, lat, lng) VALUES (?, ?, ?, ?)`, [name, cityId, lat, lng]);
		return { id: result.insertId, message: "Venue created successfully" };
	});
}

async function createBulk(venues) {
	for (const venue of venues) await create(venue);
	return { message: "Venues created successfully" };
}

function normalizeCoordinate(value) {
	if (value === null || value === undefined || value === "") {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

async function update(id, venue) {
	return db.transaction(async (query) => {
		const rows = await query(`SELECT city_id FROM venue WHERE id = ? FOR UPDATE`, [id]);
		if (!rows.length) throw Object.assign(new Error("Local não encontrado."), { statusCode: 404 });
		const cityId = await validateCityId(venue.city_id || venue.city || rows[0].city_id, query);
		const name = venue.name?.trim();
		if (!name) throw Object.assign(new Error("Indica o nome do local."), { statusCode: 400 });
		await query(`UPDATE venue SET name = ?, city_id = ?, lat = ?, lng = ? WHERE id = ?`, [name, cityId, normalizeCoordinate(venue.lat), normalizeCoordinate(venue.lng), id]);
		if (Number(rows[0].city_id) !== cityId) {
			await query(`UPDATE gig SET city_id = ? WHERE venue_id = ?`, [cityId, id]);
			await query(`UPDATE event SET city_id = ? WHERE venue_id = ?`, [cityId, id]);
		}
		return { message: "Venue updated successfully" };
	});
}

async function remove(id) {
	const result = await db.query(`DELETE FROM venue WHERE id=${id}`);

	let message = "Error in deleting Venue";

	if (result.affectedRows) {
		message = "Venue deleted successfully";
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
