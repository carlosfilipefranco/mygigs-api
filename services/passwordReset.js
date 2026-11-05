const { createHash, randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");
const emailService = require("./email");

const requestMessage = "Se existir uma conta com esse email, receberás um link para redefinir a palavra-passe. Verifica também a pasta de spam.";
const invalidMessage = "Este link é inválido ou expirou. Pede um novo email de recuperação.";

function resetPageUrl() {
	let url;
	try {
		url = new URL("/redefinir-palavra-passe", process.env.PASSWORD_RESET_SITE_URL || "https://nagrade.pt");
	} catch { /* Configuração inválida é tratada abaixo. */ }
	const local = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (!url || url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:" && process.env.NODE_ENV !== "production"))) {
		throw Object.assign(new Error("A recuperação de palavra-passe está temporariamente indisponível."), { statusCode: 503 });
	}
	return url;
}

function tokenHash(token) {
	return createHash("sha256").update(token).digest("hex");
}

async function requestReset(payload = {}) {
	const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
	if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw Object.assign(new Error("Indica um email válido."), { statusCode: 400 });
	}
	// Verificar a configuração antes de consultar a conta, sem revelar se existe.
	emailService.configuration();
	const url = resetPageUrl();
	const token = randomBytes(32).toString("hex");
	const hash = tokenHash(token);
	const recipient = await db.transaction(async query => {
		const users = await query("SELECT id, email FROM user WHERE email = ? LIMIT 1 FOR UPDATE", [email]);
		if (!users.length) return null;
		const user = users[0];
		const recent = await query("SELECT user_id FROM user_password_reset WHERE user_id = ? AND requested_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)", [user.id]);
		if (recent.length) return null;
		await query(`INSERT INTO user_password_reset (user_id, token_hash, expires_at, requested_at)
			VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), requested_at = VALUES(requested_at)`, [user.id, hash]);
		return user;
	});
	if (recipient) {
		url.hash = new URLSearchParams({ token }).toString();
		try {
			await emailService.sendPasswordReset(recipient.email, url.toString());
		} catch {
			// Manter a mesma resposta para contas existentes e inexistentes, incluindo falhas do fornecedor.
			console.error("Password reset email delivery failed");
			await db.query("DELETE FROM user_password_reset WHERE user_id = ? AND token_hash = ?", [recipient.id, hash]);
		}
	}
	return { message: requestMessage };
}

async function resetPassword(payload = {}) {
	const { token, password } = payload;
	if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
		throw Object.assign(new Error(invalidMessage), { statusCode: 400 });
	}
	if (typeof password !== "string" || password.length < 8) {
		throw Object.assign(new Error("Usa pelo menos 8 caracteres na nova palavra-passe."), { statusCode: 400 });
	}
	if (Buffer.byteLength(password, "utf8") > 72 || password.startsWith("google-")) {
		throw Object.assign(new Error("Escolhe uma palavra-passe mais curta e sem o prefixo google-."), { statusCode: 400 });
	}
	const hash = tokenHash(token);
	const candidates = await db.query("SELECT user_id FROM user_password_reset WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()", [hash]);
	if (!candidates.length) throw Object.assign(new Error(invalidMessage), { statusCode: 400 });
	const passwordHash = await bcrypt.hash(password, 10);
	await db.transaction(async query => {
		// Bloquear sempre o utilizador primeiro, tal como no pedido, para evitar deadlocks.
		await query("SELECT id FROM user WHERE id = ? FOR UPDATE", [candidates[0].user_id]);
		const result = await query("DELETE FROM user_password_reset WHERE user_id = ? AND token_hash = ? AND expires_at > UTC_TIMESTAMP()", [candidates[0].user_id, hash]);
		if (result.affectedRows !== 1) throw Object.assign(new Error(invalidMessage), { statusCode: 400 });
		await query("UPDATE user SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?", [passwordHash, candidates[0].user_id]);
	});
	return { message: "Palavra-passe atualizada. Inicia sessão com a nova palavra-passe." };
}

module.exports = { requestReset, resetPassword };
