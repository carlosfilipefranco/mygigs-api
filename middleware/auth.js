const { withNotificationActor } = require("../services/notificationContext");
const auth = require("../services/auth");
const db = require("../services/db");

// Middleware obrigatório — falha se não houver token
async function requireAuth(req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) return res.status(401).json({ message: "No token provided" });

	const token = typeof authHeader === "string" ? authHeader.match(/^Bearer\s+(\S+)$/i)?.[1] : null;
	if (!token) return res.status(401).json({ message: "Invalid token format" });

	const decoded = auth.verifyToken(token);
	if (!decoded) return res.status(401).json({ message: "Invalid or expired token" });

	try {
		const users = await db.query("SELECT auth_version FROM user WHERE id = ?", [decoded.id]);
		// Tokens anteriores à recuperação continuam válidos até à primeira redefinição.
		if (!users.length || Number(users[0].auth_version) !== (decoded.authVersion ?? 0)) {
			return res.status(401).json({ message: "Invalid or expired token" });
		}
		req.user = decoded;
		withNotificationActor(decoded.id, next);
	} catch (error) { next(error); }
}

// Acesso público sem token; uma sessão enviada mas inválida deve devolver 401.
function optionalAuth(req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		req.user = null;
		return next();
	}

	return requireAuth(req, res, next);
}

function requireAdmin(req, res, next) {
	return requireAuth(req, res, (error) => {
		if (error) return next(error);
		if (req.user.role !== "admin") {
			return res.status(403).json({ message: "Admin access required" });
		}

		next();
	});
}

module.exports = {
	requireAuth,
	optionalAuth,
	requireAdmin
};
