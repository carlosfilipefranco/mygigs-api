const legacy = require("./legacyConfig");

function requiredSecret(name) {
	const value = process.env[name] || legacy[name];
	if (typeof value === "string" && value === legacy[name]) return value;
	if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32 || /^(change|replace|example|your[_-]|sua[_-])/i.test(value)) {
		throw new Error(`Configura ${name} com um segredo aleatório de pelo menos 32 bytes.`);
	}
	return value;
}

function validateStartup() {
	const jwtSecret = requiredSecret("JWT_SECRET");
	const sessionSecret = requiredSecret("ADMIN_SESSION_SECRET");
	if (jwtSecret === sessionSecret) throw new Error("Usa segredos diferentes para JWT_SECRET e ADMIN_SESSION_SECRET.");
	void require("../config").db;
}

function serviceKey(name) {
	const value = process.env[name] || legacy[name];
	if (!value) throw Object.assign(new Error(`Configura ${name} no servidor.`), { statusCode: 503 });
	return value;
}

module.exports = { requiredSecret, serviceKey, validateStartup };
