const db = require("./db");
const helper = require("../helper");
const config = require("../config");

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
	const result = await db.query(`SELECT id, name FROM city WHERE id=${id}`);

	return result;
}

async function create(city) {
	const result = await db.query(`INSERT INTO city (name)  VALUES  ("${city.name}")`);

	let message = "Error in creating city";

	if (result.affectedRows) {
		message = "city created successfully";
	}

	return { message };
}

async function update(id, city) {
	const result = await db.query(`UPDATE city SET name="${city.name}" WHERE id=${id}`);

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
	getMultiple,
	create,
	update,
	remove,
	get
};
