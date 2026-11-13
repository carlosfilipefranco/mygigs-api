const { createHmac, randomInt, timingSafeEqual } = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");
const emailService = require("./email");
const { requiredSecret } = require("./securityConfig");
const { withPublicId } = require("./userPublicId");

function error(message, statusCode, code, retryAfter) {
	return Object.assign(new Error(message), { statusCode, code, retryAfter });
}

function normalizeEmail(value) {
	const email = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw error("Indica um email válido.", 400, "INVALID_EMAIL");
	}
	return email;
}

function emailExistsError() {
	return error("Já existe uma conta com este email. Inicia sessão ou recupera a tua palavra-passe.", 409, "EMAIL_ALREADY_EXISTS");
}

function invalidCodeError() {
	return error("O código é inválido, expirou ou atingiu o limite de tentativas. Pede um novo código.", 400, "INVALID_REGISTRATION_CODE");
}

function codeHash(email, code) {
	return createHmac("sha256", requiredSecret("JWT_SECRET"))
		.update(`registration-code\0${email}\0${code}`).digest("hex");
}

async function assertNewEmail(query, email) {
	const users = await query("SELECT id FROM user WHERE email = ? LIMIT 1", [email]);
	if (users.length) throw emailExistsError();
}

async function requestCode(payload = {}) {
	const email = normalizeEmail(payload.email);
	await assertNewEmail(db.query, email);
	emailService.configuration();
	let code = randomInt(0, 1000000).toString().padStart(6, "0");
	const result = await db.transaction(async query => {
		// Criar a linha antes de a bloquear serializa também o primeiro pedido concorrente.
		await query(`INSERT INTO user_registration_code
			(email, expires_at, requested_at, request_window_start)
			VALUES (?, UTC_TIMESTAMP(), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE email = email`, [email]);
		const rows = await query(`SELECT token_hash, request_count,
			GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), DATE_ADD(requested_at, INTERVAL 1 MINUTE))) AS resend_seconds,
			GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), DATE_ADD(request_window_start, INTERVAL 1 HOUR))) AS window_seconds
			FROM user_registration_code WHERE email = ? FOR UPDATE`, [email]);
		const previous = rows[0];
		const retryAfter = Number(previous.window_seconds) > 0 && Number(previous.request_count) >= 5
			? Number(previous.window_seconds) : Number(previous.resend_seconds);
		if (retryAfter > 0) return { retryAfter };
		let hash = codeHash(email, code);
		while (hash === previous.token_hash) {
			code = randomInt(0, 1000000).toString().padStart(6, "0");
			hash = codeHash(email, code);
		}
		const withinWindow = Number(previous.window_seconds) > 0;
		await query(`UPDATE user_registration_code SET token_hash = ?, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
			requested_at = UTC_TIMESTAMP(), failed_attempts = 0,
			request_window_start = IF(?, request_window_start, UTC_TIMESTAMP()), request_count = ? WHERE email = ?`,
		[hash, withinWindow, withinWindow ? Number(previous.request_count) + 1 : 1, email]);
		return { hash };
	});
	if (result.retryAfter) {
		throw error("Aguarda antes de pedir outro código. Podes pedir até 5 códigos por hora.", 429, "REGISTRATION_RATE_LIMITED", result.retryAfter);
	}
	try {
		await emailService.sendRegistrationCode(email, code);
	} catch {
		// Não registar destinatários, códigos ou respostas do fornecedor.
		console.error("Registration email delivery failed");
		await db.query("UPDATE user_registration_code SET expires_at = UTC_TIMESTAMP() WHERE email = ? AND token_hash = ?", [email, result.hash]);
		throw error("Não foi possível enviar o email. Tenta novamente dentro de um minuto.", 503, "EMAIL_DELIVERY_FAILED", 60);
	}
	return { message: "Código enviado. Verifica também a pasta de spam." };
}

async function completeRegistration(payload = {}) {
	const email = normalizeEmail(payload.email);
	const name = typeof payload.name === "string" ? payload.name.trim() : "";
	const { password, code } = payload;
	if (!name || name.length > 255) throw error("Indica o teu nome (até 255 caracteres).", 400, "INVALID_NAME");
	if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72 || password.startsWith("google-")) {
		throw error("Usa uma palavra-passe com pelo menos 8 caracteres, até 72 bytes e sem o prefixo google-.", 400, "INVALID_PASSWORD");
	}
	await assertNewEmail(db.query, email);
	if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw invalidCodeError();
	// A password só é guardada, com hash, depois da confirmação; nunca na tabela de códigos.
	const passwordHash = await bcrypt.hash(password, 10);
	let created;
	try {
		created = await db.transaction(async query => {
			const rows = await query(`SELECT token_hash, failed_attempts, expires_at > UTC_TIMESTAMP() AS active
				FROM user_registration_code WHERE email = ? FOR UPDATE`, [email]);
			const pending = rows[0];
			if (!pending?.active || !pending.token_hash || Number(pending.failed_attempts) >= 5) return null;
			// Usar a grafia normalizada recebida no pedido de envio, preservada no HMAC.
			const hash = codeHash(email, code);
			const storedHash = Buffer.from(pending.token_hash, "hex");
			const submittedHash = Buffer.from(hash, "hex");
			if (storedHash.length !== submittedHash.length || !timingSafeEqual(storedHash, submittedHash)) {
				await query("UPDATE user_registration_code SET failed_attempts = failed_attempts + 1 WHERE email = ?", [email]);
				return null; // Confirmar a contagem antes de devolver o erro.
			}
			await assertNewEmail(query, email);
			const { result, publicId } = await withPublicId(publicId => query(
				"INSERT INTO user (public_id, name, email, password_hash) VALUES (?, ?, ?, ?)", [publicId, name, email, passwordHash]
			));
			await query("DELETE FROM user_registration_code WHERE email = ?", [email]);
			return { id: result.insertId, public_id: publicId, name, email, image: null, role: "user" };
		});
	} catch (err) {
		// Inclui a corrida com outro registo ou uma criação de conta via Google.
		if (err.code === "ER_DUP_ENTRY" && !String(err.sqlMessage || err.message).includes("user_public_id_unique")) throw emailExistsError();
		throw err;
	}
	if (!created) throw invalidCodeError();
	return created;
}

module.exports = { requestCode, completeRegistration };
