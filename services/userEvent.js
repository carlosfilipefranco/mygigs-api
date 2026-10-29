const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const { upcomingEvent, eventEditionDate } = require("./concertDates");

const validStatuses = ["wishlist", "going", "attended", "missed"];

async function getUserEvents(userId, page = 1, filters = {}) {
	const offset = helper.getOffset(page, config.listPerPage);
	const where = ["user_event.user_id = ?"];
	const params = [userId];
	let orderBy = "event.date DESC";

	if (filters.status) {
		where.push("user_event.status = ?");
		params.push(filters.status);
	}

	if (filters.type) {
		where.push("event.type = ?");
		params.push(Number(filters.type) || 1);
	}

	if (filters.period === "upcoming") {
		where.push(upcomingEvent());
		orderBy = `COALESCE(event.date, GREATEST(CURDATE(), ${eventEditionDate()})) ASC, event.date IS NULL, event.id`;
	}

	if (filters.period === "past") {
		where.push("event.date < CURDATE()");
		orderBy = "event.date DESC";
	}

	const whereSql = `WHERE ${where.join(" AND ")}`;
	const rows = await db.query(
		`
		SELECT event.id, event.date, ${eventEditionDate()} AS edition_date_start, ${eventEditionDate("event", "date_end")} AS edition_date_end, event.name, event.image, event.type,
		       COALESCE((SELECT vn.name FROM venue_alias vn WHERE vn.id = event.venue_alias_id AND vn.venue_id = venue.id), venue.name) as venue, city.name as city,
		       user_event.status, user_event.has_ticket, user_event.favorite
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		INNER JOIN venue ON event.venue_id = venue.id
		INNER JOIN city ON event.city_id = city.id
		${whereSql}
		ORDER BY ${orderBy}
		LIMIT ${offset},${config.listPerPage}
		`,
		params
	);

	const countRows = await db.query(
		`
		SELECT COUNT(*) as count
		FROM user_event
		INNER JOIN event ON user_event.event_id = event.id
		${whereSql}
		`,
		params
	);

	return {
		data: helper.emptyOrRows(rows),
		meta: {
			page,
			count: countRows[0].count
		}
	};
}

async function setStatus(userId, eventId, status) {
	if (!validStatuses.includes(status)) {
		return { message: "Invalid status" };
	}

	await db.query(
		`
		INSERT INTO user_event (user_id, event_id, status)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE status = VALUES(status)
		`,
		[userId, eventId, status]
	);

	return { message: "Event status updated" };
}

async function toggleFavorite(userId, eventId, favorite) {
	await db.query(
		`
		INSERT INTO user_event (user_id, event_id, favorite)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE favorite = VALUES(favorite)
		`,
		[userId, eventId, favorite ? 1 : 0]
	);

	return { message: "Event favorite updated" };
}

async function toggleTicket(userId, eventId, hasTicket) {
	await db.query(
		`
		INSERT INTO user_event (user_id, event_id, has_ticket)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE has_ticket = VALUES(has_ticket)
		`,
		[userId, eventId, hasTicket ? 1 : 0]
	);

	return { message: "Event ticket updated" };
}

module.exports = {
	getUserEvents,
	setStatus,
	toggleFavorite,
	toggleTicket
};
