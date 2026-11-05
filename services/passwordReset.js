const { createHmac, randomInt, timingSafeEqual } = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");
const emailService = require("./email");
const { requiredSecret } = require("./securityConfig");

const requestMessage = "Se existir uma conta com esse email, receberás um código de recuperação. Verifica também a pasta de spam.";
const invalidMessage = "O código é inválido, expirou ou atingiu o limite de tentativas. Pede um novo código.";

function normalizeEmail(value) {
	const email = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw Object.assign(new Error("Indica um email válido."), { statusCode: 400 });
	}
	return email;
}

function codeHash(userId, code) {
	// O segredo do servidor impede a pesquisa offline dos seis dígitos a partir da BD.
	return createHmac("sha256", requiredSecret("JWT_SECRET"))
		.update(`password-reset-code\0${userId}\0${code}`).digest("hex");
}

async function requestReset(payload = {}) {
	const email = normalizeEmail(payload.email);
	emailService.configuration();
	let code = randomInt(0, 1000000).toString().padStart(6, "0");
	const recipient = await db.transaction(async query => {
		const users = await query("SELECT id, email FROM user WHERE email = ? LIMIT 1 FOR UPDATE", [email]);
		if (!users.length) return null;
		const user = users[0];
		const resets = await query(`SELECT token_hash, request_count,
			requested_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) AS recent,
			request_window_start > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) AS within_window
			FROM user_password_reset WHERE user_id = ?`, [user.id]);
		const previous = resets[0];
		if (previous?.recent || (previous?.within_window && Number(previous.request_count) >= 5)) return null;
		let hash = codeHash(user.id, code);
		while (hash === previous?.token_hash) {
			code = randomInt(0, 1000000).toString().padStart(6, "0");
			hash = codeHash(user.id, code);
		}
		const count = previous?.within_window ? Number(previous.request_count) + 1 : 1;
		await query(`INSERT INTO user_password_reset
			(user_id, token_hash, expires_at, requested_at, failed_attempts, request_window_start, request_count)
			VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), UTC_TIMESTAMP(), 0, UTC_TIMESTAMP(), ?)
			ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at),
			requested_at = VALUES(requested_at), failed_attempts = 0,
			request_window_start = IF(?, request_window_start, UTC_TIMESTAMP()), request_count = VALUES(request_count)`,
		[user.id, hash, count, Boolean(previous?.within_window)]);
		return { ...user, hash };
	});
	if (recipient) {
		try {
			await emailService.sendPasswordReset(recipient.email, code);
		} catch {
			console.error("Password reset email delivery failed");
			// Expirar o código falhado sem apagar os limites de envio da conta.
			await db.query("UPDATE user_password_reset SET expires_at = UTC_TIMESTAMP() WHERE user_id = ? AND token_hash = ?", [recipient.id, recipient.hash]);
		}
	}
	return { message: requestMessage };
}

function invalidCodeError() {
	return Object.assign(new Error(invalidMessage), { statusCode: 400, code: "INVALID_RESET_CODE" });
}

function validateCode(code) {
	if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
		throw invalidCodeError();
	}
}

// Chamado dentro de uma transação; mantém os mesmos bloqueios e limites em ambas as etapas.
async function findValidCode(query, email, code) {
	const users = await query("SELECT id FROM user WHERE email = ? LIMIT 1 FOR UPDATE", [email]);
	if (!users.length) return null;
	const userId = users[0].id;
	const resets = await query(`SELECT token_hash, failed_attempts, expires_at > UTC_TIMESTAMP() AS active
		FROM user_password_reset WHERE user_id = ? FOR UPDATE`, [userId]);
	const reset = resets[0];
	if (!reset?.active || Number(reset.failed_attempts) >= 5) return null;
	const hash = codeHash(userId, code);
	if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(reset.token_hash, "hex"))) {
		await query("UPDATE user_password_reset SET failed_attempts = failed_attempts + 1 WHERE user_id = ?", [userId]);
		// O erro é devolvido apenas depois do commit para preservar a contagem de tentativas.
		return null;
	}
	return { userId, hash };
}

async function verifyResetCode(payload = {}) {
	const email = normalizeEmail(payload.email);
	validateCode(payload.code);
	const valid = await db.transaction(query => findValidCode(query, email, payload.code));
	if (!valid) throw invalidCodeError();
	return { message: "Código confirmado. Escolhe uma nova palavra-passe." };
}

async function resetPassword(payload = {}) {
	const email = normalizeEmail(payload.email);
	const { code, password } = payload;
	validateCode(code);
	if (typeof password !== "string" || password.length < 8) {
		throw Object.assign(new Error("Usa pelo menos 8 caracteres na nova palavra-passe."), { statusCode: 400 });
	}
	if (Buffer.byteLength(password, "utf8") > 72 || password.startsWith("google-")) {
		throw Object.assign(new Error("Escolhe uma palavra-passe mais curta e sem o prefixo google-."), { statusCode: 400 });
	}
	const changed = await db.transaction(async query => {
		const valid = await findValidCode(query, email, code);
		if (!valid) return false;
		const { userId, hash } = valid;
		const passwordHash = await bcrypt.hash(password, 10);
		const consumed = await query("DELETE FROM user_password_reset WHERE user_id = ? AND token_hash = ? AND expires_at > UTC_TIMESTAMP()", [userId, hash]);
		if (consumed.affectedRows !== 1) return false;
		await query("UPDATE user SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?", [passwordHash, userId]);
		return true;
	});
	if (!changed) throw invalidCodeError();
	return { message: "Palavra-passe atualizada. Inicia sessão com a nova palavra-passe." };
}

module.exports = { requestReset, verifyResetCode, resetPassword };
