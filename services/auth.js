const jwt = require("jsonwebtoken");
const { requiredSecret } = require("./securityConfig");

function generateToken(user) {
	return jwt.sign(
		{ id: user.id, email: user.email, role: user.role || "user" },
		requiredSecret("JWT_SECRET"),
		{ algorithm: "HS256" }
	);
}

function verifyToken(token) {
	const secret = requiredSecret("JWT_SECRET");
	try {
		const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
		if (!Number.isSafeInteger(Number(payload.id)) || Number(payload.id) <= 0) return null;
		if (!["user", "admin"].includes(payload.role)) return null;
		return payload;
	} catch {
		return null;
	}
}

module.exports = { generateToken, verifyToken };
