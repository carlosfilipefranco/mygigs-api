const mysql = require("mysql2/promise");
const config = require("../config");

var connection = null;

async function start() {
	if (!connection) {
		connection = await mysql.createPool(config.db);
	}

	return connection;
}

async function query(sql, params) {
	const db = await start();
	const [results] = await db.execute(sql, params);

	return results;
}

module.exports = {
	query
};
