const db = require("./db");
const helper = require("../helper");
const config = require("../config");

// Equivalência confirmada, limitada a Lisboa/Lisbon.
function normalizeCityName(value, countryCode = null) {
	const name = String(value || "").trim();
	if (countryCode && String(countryCode).toUpperCase() !== "PT") return name;
	return /^(lisbon|lisboa)$/i.test(name) ? "Lisboa" : name;
}

function normalizeCityState(value, countryCode = null) {
	const state = value == null ? null : String(value).trim() || null;
	if (countryCode && String(countryCode).toUpperCase() !== "PT") return state;
	return /^(lisbon|lisboa)$/i.test(state || "") ? "Lisboa" : state;
}

async function getMultiple(page) {
	let offset = null;
	let limit = "";
	if (page) {
		offset = helper.getOffset(page, config.listPerPage);
		limit = `LIMIT ${offset},${config.listPerPage}`;
	}
	let rows = await db.query(`SELECT id, name FROM city ${limit}`);
	let data = helper.emptyOrRows(rows);
	let meta = { page };

	return {
		data,
		meta
	};
}

async function get(id) {
	const result = await db.query(`SELECT id, name FROM city WHERE id=?`, [id]);

	return result;
}

async function create(city) {
	const name = normalizeCityName(city.name);
	const state = normalizeCityState(city.state);
	const existing = await db.query(`SELECT id FROM city WHERE name = ? LIMIT 1`, [name]);
	if (existing.length) return { message: "A cidade já existe.", id: existing[0].id };
	const result = await db.query(`INSERT INTO city (name, state) VALUES (?, ?)`, [name, state]);

	let message = "Error in creating city";

	if (result.affectedRows) {
		message = "city created successfully";
	}

	return { message };
}

async function update(id, city) {
	const result = await db.query(`UPDATE city SET name=? WHERE id=?`, [normalizeCityName(city.name), id]);

	let message = "Error in updating city";

	if (result.affectedRows) {
		message = "city updated successfully";
	}

	return { message };
}

async function remove(id) {
	const result = await db.query(`DELETE FROM city WHERE id=${id}`);

	let message = "Error in deleting city";

	if (result.affectedRows) {
		message = "city deleted successfully";
	}

	return { message };
}

module.exports = {
	normalizeCityName,
	normalizeCityState,
	getMultiple,
	create,
	update,
	remove,
	get
};
