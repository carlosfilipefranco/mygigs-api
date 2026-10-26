const db = require("./db");

const pageSize = 20;
const commentSelect = `SELECT c.id, c.gig_id, c.user_id, c.body,
	UNIX_TIMESTAMP(c.created_at) * 1000 AS created_at_ms,
	COALESCE(u.name, 'Conta eliminada') AS user_name, u.image AS user_image
	FROM gig_comment c LEFT JOIN user u ON u.id = c.user_id`;

function fail(statusCode, message) {
	const error = new Error(message);
	error.statusCode = statusCode;
	throw error;
}

function positiveId(value) {
	if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, "Identificador inválido.");
	return Number(value);
}

function hydrate(row) {
	const { created_at_ms, ...comment } = row;
	return { ...comment, created_at: new Date(Number(created_at_ms)).toISOString() };
}

async function requireGig(gigId, query = db.query, lock = false) {
	const rows = await query(`SELECT id FROM gig WHERE id = ?${lock ? " FOR SHARE" : ""}`, [gigId]);
	if (!rows.length) fail(404, "Concerto não encontrado.");
}

async function list(gigIdentifier, before) {
	const gigId = positiveId(gigIdentifier);
	const cursor = before === undefined ? null : positiveId(before);
	await requireGig(gigId);
	const rows = await db.query(`${commentSelect} WHERE c.gig_id = ?${cursor ? " AND c.id < ?" : ""} ORDER BY c.id DESC LIMIT ${pageSize + 1}`, cursor ? [gigId, cursor] : [gigId]);
	const data = rows.slice(0, pageSize).map(hydrate);
	const hasMore = rows.length > pageSize;
	return { data, hasMore, nextCursor: hasMore ? data[data.length - 1].id : null };
}

async function create(gigIdentifier, input, userIdentifier) {
	const gigId = positiveId(gigIdentifier);
	if (!userIdentifier) fail(401, "Inicia sessão para comentar.");
	const userId = positiveId(userIdentifier);
	if (typeof input?.body !== "string" || !input.body.trim() || input.body.trim().length > 2000) {
		fail(400, "Escreve um comentário entre 1 e 2000 caracteres.");
	}
	const body = input.body.trim();
	return db.transaction(async (query) => {
		await requireGig(gigId, query, true);
		const users = await query(`SELECT id FROM user WHERE id = ? FOR SHARE`, [userId]);
		if (!users.length) fail(401, "A tua sessão deixou de ser válida.");
		const result = await query(`INSERT INTO gig_comment (gig_id, user_id, body) VALUES (?, ?, ?)`, [gigId, userId, body]);
		const rows = await query(`${commentSelect} WHERE c.id = ? AND c.gig_id = ?`, [result.insertId, gigId]);
		return { comment: hydrate(rows[0]) };
	});
}

async function remove(gigIdentifier, commentIdentifier, user) {
	const gigId = positiveId(gigIdentifier);
	const commentId = positiveId(commentIdentifier);
	if (!user?.id) fail(401, "Inicia sessão para apagar comentários.");
	const userId = positiveId(user.id);
	return db.transaction(async (query) => {
		const rows = await query(`SELECT user_id FROM gig_comment WHERE id = ? AND gig_id = ? FOR UPDATE`, [commentId, gigId]);
		if (!rows.length) fail(404, "Comentário não encontrado.");
		if (Number(rows[0].user_id) !== userId && user.role !== "admin") fail(403, "Só podes apagar os teus comentários.");
		await query(`DELETE FROM gig_comment WHERE id = ? AND gig_id = ?`, [commentId, gigId]);
		return { success: true };
	});
}

module.exports = { list, create, remove };
