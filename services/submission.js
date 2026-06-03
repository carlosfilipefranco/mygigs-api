const db = require("./db");
const artistService = require("./artist");
const venueService = require("./venue");
const festivalService = require("./festival");
const editionService = require("./edition");
const eventService = require("./event");

const ALLOWED_ENTITY_TYPES = new Set(["artist", "venue", "festival", "edition", "event"]);
const ALLOWED_STATUSES = new Set(["pending", "approved", "rejected"]);

function normalizeEntityType(value) {
	const entityType = (value || "").toString().trim().toLowerCase();
	return ALLOWED_ENTITY_TYPES.has(entityType) ? entityType : null;
}

function normalizeStatus(value) {
	const status = (value || "pending").toString().trim().toLowerCase();
	return ALLOWED_STATUSES.has(status) ? status : "pending";
}

function normalizeLimit(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 50;
	}

	return Math.min(parsed, 200);
}

function parsePayload(payload) {
	if (!payload) {
		return {};
	}

	if (typeof payload === "object") {
		return payload;
	}

	try {
		return JSON.parse(payload);
	} catch {
		return {};
	}
}

function serializePayload(payload) {
	const parsedPayload = parsePayload(payload);
	if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
		throw new Error("Invalid suggestion payload");
	}

	if (!Object.keys(parsedPayload).length) {
		throw new Error("Suggestion payload is empty");
	}

	return JSON.stringify(parsedPayload);
}

async function getById(id) {
	const rows = await db.query(
		`
		SELECT
			us.*,
			us.submission_action AS action,
			user.name AS user_name,
			user.email AS user_email,
			reviewer.name AS reviewer_name
		FROM user_submission us
		INNER JOIN user ON user.id = us.user_id
		LEFT JOIN user reviewer ON reviewer.id = us.reviewed_by
		WHERE us.id = ?
		LIMIT 1
		`,
		[id]
	);

	if (!rows.length) {
		return null;
	}

	return hydrateSubmission(rows[0]);
}

function hydrateSubmission(row) {
	return {
		...row,
		payload: parsePayload(row.payload)
	};
}

async function create(userId, input) {
	const entityType = normalizeEntityType(input?.entity_type || input?.entityType);
	if (!entityType) {
		throw new Error("Invalid suggestion type");
	}

	const action = (input?.action || "create").toString().trim().toLowerCase();
	if (action !== "create") {
		throw new Error("Invalid suggestion action");
	}

	const payload = serializePayload(input?.payload);
	const result = await db.query(
		`
		INSERT INTO user_submission (user_id, entity_type, submission_action, status, payload)
		VALUES (?, ?, ?, 'pending', ?)
		`,
		[userId, entityType, action, payload]
	);

	return {
		id: result.insertId,
		message: "Sugestão enviada para revisão."
	};
}

async function getMultiple(status = "pending", limit = 50) {
	const normalizedStatus = normalizeStatus(status);
	const normalizedLimit = normalizeLimit(limit);
	const rows = await db.query(
		`
		SELECT
			us.*,
			us.submission_action AS action,
			user.name AS user_name,
			user.email AS user_email,
			reviewer.name AS reviewer_name
		FROM user_submission us
		INNER JOIN user ON user.id = us.user_id
		LEFT JOIN user reviewer ON reviewer.id = us.reviewed_by
		WHERE us.status = ?
		ORDER BY us.created_at DESC
		LIMIT ${normalizedLimit}
		`,
		[normalizedStatus]
	);

	return {
		data: rows.map(hydrateSubmission)
	};
}

async function getMine(userId, status = null, limit = 50) {
	const normalizedLimit = normalizeLimit(limit);
	const filters = ["us.user_id = ?"];
	const params = [userId];

	if (status) {
		filters.push("us.status = ?");
		params.push(normalizeStatus(status));
	}

	const rows = await db.query(
		`
		SELECT
			us.*,
			us.submission_action AS action,
			user.name AS user_name,
			user.email AS user_email,
			reviewer.name AS reviewer_name
		FROM user_submission us
		INNER JOIN user ON user.id = us.user_id
		LEFT JOIN user reviewer ON reviewer.id = us.reviewed_by
		WHERE ${filters.join(" AND ")}
		ORDER BY us.created_at DESC
		LIMIT ${normalizedLimit}
		`,
		params
	);

	return {
		data: rows.map(hydrateSubmission)
	};
}

async function approve(id, adminId, input = {}) {
	const submission = await getById(id);
	if (!submission) {
		throw new Error("Suggestion not found");
	}

	if (submission.status !== "pending") {
		throw new Error("Suggestion was already reviewed");
	}

	const approvalResult = await applySuggestion(submission);
	await db.query(
		`
		UPDATE user_submission
		SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
		WHERE id = ?
		`,
		[input?.admin_note || input?.note || null, adminId, id]
	);

	return {
		message: "Sugestão aprovada.",
		result: approvalResult
	};
}

async function reject(id, adminId, input = {}) {
	const submission = await getById(id);
	if (!submission) {
		throw new Error("Suggestion not found");
	}

	if (submission.status !== "pending") {
		throw new Error("Suggestion was already reviewed");
	}

	await db.query(
		`
		UPDATE user_submission
		SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
		WHERE id = ?
		`,
		[input?.admin_note || input?.note || null, adminId, id]
	);

	return {
		message: "Sugestão rejeitada."
	};
}

async function applySuggestion(submission) {
	const payload = submission.payload || {};

	if (submission.entity_type === "artist") {
		const artists = Array.isArray(payload.artists) ? payload.artists.map((name) => `${name}`.trim()).filter(Boolean) : [];
		if (artists.length === 1 && payload.image) {
			return artistService.create({ name: artists[0], image: payload.image, mbid: payload.mbid || null, type: payload.type || 1 });
		}

		if (artists.length) {
			return artistService.createBulk({ artists, type: payload.type || 1 });
		}

		return artistService.create(payload);
	}

	if (submission.entity_type === "venue") {
		return venueService.create(payload);
	}

	if (submission.entity_type === "festival") {
		return festivalService.create(payload);
	}

	if (submission.entity_type === "edition") {
		return editionService.create(payload);
	}

	if (submission.entity_type === "event") {
		return eventService.create(payload);
	}

	throw new Error("Unsupported suggestion type");
}

module.exports = {
	create,
	getMultiple,
	getMine,
	approve,
	reject
};
