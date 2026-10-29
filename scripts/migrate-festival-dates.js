const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const config = require("../config");

async function main() {
	const sql = await fs.readFile(path.join(__dirname, "../migrations/20261029_festival_official_dates.sql"), "utf8");
	if (!process.argv.includes("--apply")) {
		console.log(sql);
		console.log("-- Para aplicar: node scripts/migrate-festival-dates.js --apply");
		return;
	}
	const connection = await mysql.createConnection({ ...config.db, multipleStatements: true });
	try {
		await connection.query(sql);
		console.log("Suporte para datas oficiais dos festivais aplicado.");
	} finally {
		await connection.end();
	}
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
