const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { zones } = require('../services/geography');
const audited = require('../data/audited-city-geography.json');

async function main() {
	const apply = process.argv.includes('--apply');
	if (!apply) {
		console.log(JSON.stringify({ mode: 'preview', zones, auditedCities: audited.cities.length,
			changes: ['Add geographic metadata and discovery zones', 'Preserve audited city IDs and classifications', 'Allow city names in different geographic contexts', 'Keep ambiguous locations unclassified'],
			command: 'node scripts/migrate-geography.js --apply' }, null, 2));
		return;
	}
	const connection = await mysql.createConnection({ ...require('../config').db, multipleStatements: true });
	try {
		const [[lock]] = await connection.query("SELECT GET_LOCK(CONCAT(LEFT(DATABASE(), 32), ':geography-migration'), 10) AS acquired");
		if (Number(lock.acquired) !== 1) throw new Error('Já está a decorrer uma migração geográfica.');
		await connection.query(await fs.readFile(path.join(__dirname, '../migrations/20261028_city_geography.sql'), 'utf8'));
		await connection.query(`CREATE TABLE IF NOT EXISTS discovery_zone (
			code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			name VARCHAR(100) NOT NULL, position INT NOT NULL,
			CONSTRAINT discovery_zone_country_fk FOREIGN KEY (country_code) REFERENCES country(code)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		const addColumns = async (table, definitions) => {
			const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
			const existing = new Set(columns.map(column => column.Field));
			for (const [column, definition] of Object.entries(definitions)) {
				if (!existing.has(column)) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
			}
		};
		await addColumns('country_subdivision', { zone_code: 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL' });
		await addColumns('city', {
			municipality: 'VARCHAR(150) NULL', zone_code: 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL',
			source: 'VARCHAR(32) NULL', source_id: 'VARCHAR(128) NULL', geography_source: 'VARCHAR(128) NULL',
			classification_status: "ENUM('pending','confirmed') NOT NULL DEFAULT 'pending'",
			country_scope: "VARCHAR(2) GENERATED ALWAYS AS (COALESCE(country_code, '')) STORED",
			subdivision_scope: 'INT UNSIGNED GENERATED ALWAYS AS (COALESCE(subdivision_id, 0)) STORED',
			municipality_scope: "VARCHAR(150) GENERATED ALWAYS AS (COALESCE(municipality, '')) STORED",
			source_scope: "VARCHAR(128) GENERATED ALWAYS AS (COALESCE(source_id, '')) STORED"
		});
		for (const table of ['city','country_subdivision']) {
			const constraint = `${table}_zone_fk`;
			const [constraints] = await connection.execute('SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?',[table,constraint]);
			if (!constraints.length) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY(zone_code) REFERENCES discovery_zone(code)`);
		}
		const [indexes] = await connection.query('SHOW INDEX FROM city');
		if (!indexes.some(index => index.Key_name === 'city_geography_name_unique')) {
			await connection.query('ALTER TABLE city ADD UNIQUE KEY city_geography_name_unique (name, country_scope, subdivision_scope, municipality_scope, source_scope)');
		}
		if (!indexes.some(index => index.Key_name === 'city_source_unique')) {
			await connection.query('ALTER TABLE city ADD UNIQUE KEY city_source_unique (source, source_id)');
		}
		// Replace only the old single-column uniqueness constraint, preserving all IDs and relations.
		for (const name of new Set(indexes.filter(index => index.Non_unique === 0 && index.Key_name !== 'PRIMARY').map(index => index.Key_name))) {
			const parts = indexes.filter(index => index.Key_name === name);
			if (parts.length === 1 && parts[0].Column_name === 'name') await connection.query(`ALTER TABLE city DROP INDEX \`${name.replace(/`/g, '``')}\``);
		}
		await connection.beginTransaction();
		for (const country of audited.countries) await connection.execute('INSERT INTO country(code,name) VALUES (?,?) ON DUPLICATE KEY UPDATE code=VALUES(code)', [country.code, country.name]);
		for (const [position, zone] of zones.entries()) {
			await connection.execute('INSERT INTO discovery_zone(code,country_code,name,position) VALUES (?,\'PT\',?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),position=VALUES(position)', [zone.code, zone.name, position]);
			for (const subdivision of zone.subdivisions) {
				await connection.execute('INSERT INTO country_subdivision(country_code,name,kind,zone_code) VALUES (\'PT\',?,?,?) ON DUPLICATE KEY UPDATE zone_code=VALUES(zone_code)', [subdivision, ['Açores', 'Madeira'].includes(subdivision) ? 'autonomous_region' : 'district', zone.code]);
			}
		}
		for (const subdivision of audited.subdivisions) await connection.execute('INSERT INTO country_subdivision(country_code,name,kind) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)', [subdivision.country_code, subdivision.name, subdivision.kind]);
		for (const city of audited.cities) {
			await connection.execute(`UPDATE city c LEFT JOIN country_subdivision s ON s.country_code = ? AND s.name = ?
				SET c.country_code = ?, c.subdivision_id = COALESCE(c.subdivision_id,s.id),
				c.geography_source = COALESCE(c.geography_source,'audit:2026-10-28'), c.classification_status = 'confirmed'
				WHERE c.id = ? AND c.name = ? AND (c.country_code IS NULL OR c.country_code = ?)`,
				[city.country_code, city.subdivision_name, city.country_code, city.id, city.name, city.country_code]);
		}
		// Existing classifications are retained even when they were added after the audit snapshot.
		await connection.query("UPDATE city SET classification_status=IF(subdivision_id IS NULL,'pending','confirmed'), geography_source='existing:2026-10-30' WHERE country_code IS NOT NULL AND geography_source IS NULL");
		await connection.commit();
		const [summary] = await connection.query(`SELECT c.country_code, COALESCE(c.zone_code,s.zone_code) AS zone, COUNT(*) AS cities
			FROM city c LEFT JOIN country_subdivision s ON s.id=c.subdivision_id GROUP BY c.country_code,zone ORDER BY c.country_code,zone`);
		console.log(JSON.stringify({ applied: true, summary }, null, 2));
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		await connection.query("SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(), 32), ':geography-migration'))");
		await connection.end();
	}
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
