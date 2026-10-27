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

async function transaction(callback, { lockName = null } = {}) {
	const db = await start();
	const connection = await db.getConnection();

	let locked = false;
	try {
		if (lockName) {
			const [rows] = await connection.execute("SELECT GET_LOCK(CONCAT(LEFT(DATABASE(), 32), ':', ?), 10) AS acquired", [lockName]);
			if (Number(rows[0]?.acquired) !== 1) {
				throw Object.assign(new Error("Está a decorrer outra importação. Tenta novamente."), { statusCode: 409 });
			}
			locked = true;
		}
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
		try {
			if (locked) await connection.execute("SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(), 32), ':', ?))", [lockName]);
		} finally {
			connection.release();
		}
	}
}

module.exports = {
	query,
	transaction
};
