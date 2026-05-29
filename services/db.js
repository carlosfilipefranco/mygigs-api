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

async function transaction(callback) {
	const db = await start();
	const connection = await db.getConnection();

	try {
		await connection.beginTransaction();
		const transactionQuery = async (sql, params) => {
			const [results] = await connection.execute(sql, params);
			return results;
		};

		const result = await callback(transactionQuery);
		await connection.commit();
		return result;
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

module.exports = {
	query,
	transaction
};
