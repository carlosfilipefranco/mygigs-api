const auth = require("../services/auth");

module.exports = function (req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) return res.status(401).json({ message: "No token provided" });

	const token = authHeader.split(" ")[1]; // Bearer <token>
	if (!token) return res.status(401).json({ message: "Invalid token format" });

	const decoded = auth.verifyToken(token);
	if (!decoded) return res.status(401).json({ message: "Invalid or expired token" });

	req.user = decoded; // id e email
	next();
};
