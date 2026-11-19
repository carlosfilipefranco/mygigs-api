const db = require("./db");
const artistService = require("./artist");
const venueService = require("./venue");
const festivalService = require("./festival");
const editionService = require("./edition");
const eventService = require("./event");
const submissionFile = require("./submissionFile");
const setlistFm = require("./setlistFmImport");
const notifications = require("./notifications");

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

async function getById(id, query = db.query, lock = false) {
	if (lock) await query("SELECT id FROM user_submission WHERE id = ? FOR UPDATE", [id]);
	const rows = await query(
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
	const payload = parsePayload(row.payload);
	if (payload.submission_kind === "concert_list" && payload.file) {
		const { key, ...file } = payload.file;
		payload.file = file;
	}
	return {
		...row,
		payload
	};
}

function invalid(message, statusCode = 400) {
	throw Object.assign(new Error(message), { statusCode });
}

function normalizeConcertSuggestion(payload) {
	const text = (value, label, max) => {
		if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${label} inválido.`);
		return value.trim();
	};
	const artist = text(payload.artist_name, 'Artista', 200);
	const venue = text(payload.venue_name, 'Local', 300);
	const date = payload.date;
	if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid('Indica uma data válida.');
	const parsed = new Date(`${date}T12:00:00Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) invalid('Indica uma data válida.');
	return { submission_kind: 'concert', artist_name: artist, venue_name: venue, date };
}

function reviewMessage(input) {
	const message = input.user_message ?? '';
	if (typeof message !== 'string' || message.length > 1000) invalid('A mensagem pode ter até 1000 caracteres.');
	return message.trim();
}

async function create(userId, input) {
	if (parsePayload(input?.payload)?.submission_kind === "concert_list") {
		throw Object.assign(new Error("Envia a listagem através do upload de ficheiros."), { statusCode: 400 });
	}
	const entityType = normalizeEntityType(input?.entity_type || input?.entityType);
	if (!entityType) {
		throw new Error("Invalid suggestion type");
	}

	const action = (input?.action || "create").toString().trim().toLowerCase();
	if (action !== "create") {
		throw new Error("Invalid suggestion action");
	}

	const rawPayload = parsePayload(input?.payload);
	const payload = serializePayload(entityType === "event" && (rawPayload.submission_kind === "concert" || Number(rawPayload.type) !== 2) ? normalizeConcertSuggestion(rawPayload) : rawPayload);
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

async function createFile(userId, input) {
	const note = typeof input?.note === "string" ? input.note.trim() : "";
	if (note.length > 2000) throw Object.assign(new Error("A nota pode ter até 2000 caracteres."), { statusCode: 400 });
	const file = await submissionFile.store(input?.file);
	try {
		const result = await db.query(`INSERT INTO user_submission (user_id, entity_type, submission_action, status, payload)
			VALUES (?, 'event', 'create', 'pending', ?)`,
			[userId, JSON.stringify({ submission_kind: "concert_list", file, note })]);
		return { id: result.insertId, message: "Listagem enviada para análise pelo administrador." };
	} catch (error) {
		await submissionFile.remove(file.key).catch(() => {});
		throw error;
	}
}

async function getFile(id) {
	const rows = await db.query("SELECT payload FROM user_submission WHERE id = ? LIMIT 1", [id]);
	const payload = parsePayload(rows[0]?.payload);
	if (payload.submission_kind !== "concert_list" || !payload.file?.key) {
		throw Object.assign(new Error("Ficheiro não encontrado."), { statusCode: 404 });
	}
	return { path: submissionFile.filePath(payload.file.key), name: payload.file.name };
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
	const initial = await getById(id);
	if (!initial) invalid('Sugestão não encontrada.', 404);
	if (initial.status !== 'pending') invalid('Esta sugestão já foi analisada.', 409);
	const message = reviewMessage(input);
	const isConcert = initial.entity_type === 'event' && initial.payload.submission_kind === 'concert';
	const isFile = initial.payload.submission_kind === 'concert_list';
	let entries = [];
	let eventIds = [];
	if (isFile && !message) invalid('Escreve um comentário para o utilizador sobre a listagem.');
	if (isConcert || isFile) {
		const ids = input.setlistfm_ids || (input.setlistfm_id ? [input.setlistfm_id] : []);
		const manualIds = input.event_ids || [];
		if (!Array.isArray(ids) || !Array.isArray(manualIds) || ids.length + manualIds.length > 100) invalid('Seleciona até 100 concertos.');
		if (manualIds.some(id => !Number.isSafeInteger(id) || id <= 0)) invalid('Evento inválido.');
		eventIds = [...new Set(manualIds)];
		const count = new Set(ids).size + eventIds.length;
		if (!count || (isConcert && count !== 1)) invalid('Seleciona o concerto a aprovar ou cria-o manualmente.');
		for (const id of [...new Set(ids)]) entries.push(await setlistFm.loadConcert(id));
	}
	return db.transaction(async query => {
		const submission = await getById(id, query, true);
		if (!submission || submission.status !== 'pending') invalid('Esta sugestão já foi analisada.', 409);
		let result = (isConcert || isFile)
			? (entries.length ? await setlistFm.persistEntries(entries, { type: 1, import_setlists: true }, query) : null)
			: await applySuggestion(submission);
		// Older event suggestions return an event identifier rather than imported gig results.
		if (submission.entity_type === 'event' && !isConcert && !isFile && result?.id) {
			eventIds = [result.id];
			const createdGigs = await query('SELECT gig_id, event_id FROM event_gig WHERE event_id = ? ORDER BY gig_id FOR UPDATE', [result.id]);
			result = { ...result, results: createdGigs };
		}
		if (eventIds.length && (isConcert || isFile)) {
			const manualResults = [];
			for (const eventId of eventIds) {
				const rows = await query(`SELECT eg.gig_id, eg.event_id FROM event_gig eg INNER JOIN event e ON e.id = eg.event_id WHERE e.id = ? AND e.type = 1`, [eventId]);
				if (!rows.length) invalid('O concerto criado manualmente já não está disponível.');
				manualResults.push(...rows);
			}
			result = { ...result, results: [...(result?.results || []), ...manualResults] };
		}
		// Keep the original free-text request intact and record the moderation result.
		const rows = await query('SELECT payload FROM user_submission WHERE id = ?', [id]);
		const payload = parsePayload(rows[0].payload);
		payload.review = { message, gig_ids: [...new Set(result?.results?.map(entry => entry.gig_id) || [])], setlistfm_ids: entries.map(entry => entry.setlistfm_id), event_ids: eventIds };
		await query(`UPDATE user_submission SET status = 'approved', payload = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
			[JSON.stringify(payload), input.admin_note || input.note || null, adminId, id]);
		await notifications.publishSubmissionReview(query, submission, true, result, message);
		return { message: 'Sugestão aprovada. O utilizador será notificado.', result };
	}, { lockName: (isConcert || isFile) ? 'setlistfm-import' : null });
}

async function reject(id, adminId, input = {}) {
	const message = reviewMessage(input);
	return db.transaction(async query => {
		const submission = await getById(id, query, true);
		if (!submission) invalid('Sugestão não encontrada.', 404);
		if (submission.status !== 'pending') invalid('Esta sugestão já foi analisada.', 409);
		if (submission.payload.submission_kind === 'concert_list' && !message) invalid('Escreve um comentário para o utilizador sobre a listagem.');
		const rows = await query('SELECT payload FROM user_submission WHERE id = ?', [id]);
		const payload = parsePayload(rows[0].payload);
		payload.review = { message, gig_ids: [] };
		await query(`UPDATE user_submission SET status = 'rejected', payload = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
			[JSON.stringify(payload), input.admin_note || input.note || null, adminId, id]);
		await notifications.publishSubmissionReview(query, submission, false, null, message);
		return { message: 'Sugestão rejeitada. O utilizador será notificado.' };
	});
}

async function applySuggestion(submission) {
	const payload = submission.payload || {};
	// As listagens são analisadas manualmente; aprová-las não cria concertos automaticamente.
	if (payload.submission_kind === "concert_list") return null;

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
	createFile,
	getFile,
	getMultiple,
	getMine,
	approve,
	reject
};
