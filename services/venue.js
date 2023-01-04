const db = require("./db");
const helper = require("../helper");
const config = require("../config");

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(venue.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT id, name FROM venue ${searchQuery}  LIMIT ${offset},${config.listPerPage}`);
	const data = helper.emptyOrRows(rows);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM venue`);
		count = row[0].count;
	}

	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function create(venue) {
	const result = await db.query(`INSERT INTO venue (name)  VALUES  ("${venue.name}")`);

	let message = "Error in creating venue";

	if (result.affectedRows) {
		message = "venue created successfully";
	}

	return { message };
}

async function update(id, venue) {
	const result = await db.query(`UPDATE venue SET name="${venue.name}" WHERE id=${id}`);

	let message = "Error in updating venue";

	if (result.affectedRows) {
		message = "venue updated successfully";
	}

	return { message };
}

async function remove(id) {
	const result = await db.query(`DELETE FROM venue WHERE id=${id}`);

	let message = "Error in deleting venue";

	if (result.affectedRows) {
		message = "venue deleted successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	create,
	update,
	remove
};
