const jwt = require("jsonwebtoken");
const secret = "SUA_CHAVE_SECRETA_AQUI"; // Muda para algo seguro

module.exports = {
	generateToken,
	verifyToken
};

function generateToken(user) {
	return jwt.sign(
		{ id: user.id, email: user.email },
		secret,
		{ expiresIn: "7d" } // expira em 7 dias
	);
}

function verifyToken(token) {
	try {
		return jwt.verify(token, secret);
	} catch (err) {
		return null;
	}
}
