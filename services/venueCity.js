const db = require("./db");

async function getVenueCityId(venueId, query = db.query) {
	const id = Number(venueId);
	if (!Number.isInteger(id) || id <= 0) {
		throw Object.assign(new Error("Local inválido."), { statusCode: 400 });
	}
	const rows = await query(`SELECT c.id AS city_id FROM venue v LEFT JOIN city c ON c.id = v.city_id WHERE v.id = ? FOR UPDATE`, [id]);
	if (!rows.length) {
		throw Object.assign(new Error("Local não encontrado."), { statusCode: 404 });
	}
	if (!rows[0].city_id) {
		throw Object.assign(new Error("Define a cidade do local antes de o associar a um concerto."), { statusCode: 400 });
	}
	return Number(rows[0].city_id);
}

async function validateCityId(value, query = db.query) {
	const id = Number(value?.id || value);
	if (!Number.isInteger(id) || id <= 0 || !(await query(`SELECT id FROM city WHERE id = ?`, [id])).length) {
		throw Object.assign(new Error("Seleciona uma cidade válida para o local."), { statusCode: 400 });
	}
	return id;
}

module.exports = { getVenueCityId, validateCityId };
