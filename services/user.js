const db = require("./db");
const bcrypt = require("bcryptjs");

module.exports = {
	create,
	login,
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
		email
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
		email: user.email
	};
}

async function get(id) {
	const users = await db.query(`SELECT id, name, email, created_at FROM user WHERE id = ?`, [id]);

	return users.length ? users[0] : null;
}
