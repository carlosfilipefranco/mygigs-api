const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const config = require('../config');

async function main() {
	const sql = await fs.readFile(path.join(__dirname, '../migrations/20261120_home_slide_selection.sql'), 'utf8');
	if (!process.argv.includes('--apply')) {
		console.log(sql);
		console.log('-- Para aplicar: node scripts/migrate-home-slides.js --apply');
		return;
	}
	const connection = await mysql.createConnection(config.db);
	try {
		await connection.query(sql);
		console.log('Seleção manual dos slides da home disponível. O destaque principal foi preservado.');
	} finally { await connection.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
