const auth = require("../services/auth");

// Middleware obrigatório — falha se não houver token
function requireAuth(req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) return res.status(401).json({ message: "No token provided" });

	const token = authHeader.split(" ")[1];
	if (!token) return res.status(401).json({ message: "Invalid token format" });

	const decoded = auth.verifyToken(token);
	if (!decoded) return res.status(401).json({ message: "Invalid or expired token" });

	req.user = decoded;
	next();
}

// Middleware opcional — token é lido se existir, mas nunca falha
function optionalAuth(req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		req.user = null;
		return next();
	}

	const token = authHeader.split(" ")[1];
	if (!token) {
		req.user = null;
		return next();
	}

	const decoded = auth.verifyToken(token);
	if (!decoded) {
		req.user = null;
		return next();
	}

	req.user = decoded;
	next();
}

module.exports = {
	requireAuth,
	optionalAuth
};
