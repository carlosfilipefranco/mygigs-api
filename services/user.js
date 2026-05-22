const db = require("./db");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client();
const GOOGLE_CLIENT_ID_FALLBACK = "276222082601-rjqv1u7qlaqa5obmr6d882om73mlt3tl.apps.googleusercontent.com";

module.exports = {
	create,
	login,
	loginWithGoogle,
	get
};

async function create(user) {
	const { name, email, password } = user;

	// Hash seguro
	const passwordHash = await bcrypt.hash(password, 10);

	const result = await db.query(
		`
    INSERT INTO user (name, email, password_hash)
    VALUES (?, ?, ?)
    `,
		[name, email, passwordHash]
	);

	return {
		id: result.insertId,
		name,
		email,
		role: "user"
	};
}

async function login(email, password) {
	const users = await db.query(`SELECT * FROM user WHERE email = ?`, [email]);

	if (!users.length) return null;

	const user = users[0];

	const isValid = await bcrypt.compare(password, user.password_hash);

	if (!isValid) return null;

	return {
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role || "user"
	};
}

async function loginWithGoogle(payload) {
	const idToken = payload?.idToken;

	if (!idToken) {
		const error = new Error("Google token em falta");
		error.statusCode = 400;
		throw error;
	}

	const audience = getGoogleAudience();
	const ticket = await googleClient.verifyIdToken({
		idToken,
		audience
	});

	const tokenPayload = ticket.getPayload();
	const email = tokenPayload?.email?.trim().toLowerCase();
	const emailVerified = tokenPayload?.email_verified === true;

	if (!email || !emailVerified) {
		const error = new Error("Conta Google inválida");
		error.statusCode = 401;
		throw error;
	}

	const googleName = tokenPayload?.name?.trim();
	const fallbackName = email.split("@")[0];
	const safeName = (googleName || fallbackName || "Utilizador").slice(0, 255);
	const users = await db.query(`SELECT id, name, email, role FROM user WHERE email = ? LIMIT 1`, [email]);

	if (users.length) {
		const user = users[0];
		return {
			id: user.id,
			name: user.name || safeName,
			email: user.email,
			role: user.role || "user"
		};
	}

	const generatedPasswordHash = await bcrypt.hash(`google-${tokenPayload?.sub || Date.now()}`, 10);
	const result = await db.query(
		`
		INSERT INTO user (name, email, password_hash)
		VALUES (?, ?, ?)
		`,
		[safeName, email, generatedPasswordHash]
	);

	return {
		id: result.insertId,
		name: safeName,
		email,
		role: "user"
	};
}

function getGoogleAudience() {
	const envClientIds = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_IDS]
		.filter(Boolean)
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter(Boolean);

	if (envClientIds.length) {
		return envClientIds;
	}

	return [GOOGLE_CLIENT_ID_FALLBACK];
}

async function get(id) {
	const users = await db.query(`SELECT id, name, email, created_at FROM user WHERE id = ?`, [id]);

	return users.length ? users[0] : null;
}
