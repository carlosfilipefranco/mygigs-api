// Creates a private, consistent logical backup. Never restores or deletes backups.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createGzip, createGunzip } = require('zlib');
const { createInterface } = require('readline');
const mysql = require('mysql2/promise');
const config = require('../config');

function option(value) {
	return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

async function main() {
	const args = process.argv.slice(2);
	if (args.some(arg => !arg.startsWith('--output-directory=')) || args.length > 1) {
		throw new Error('Usage: node scripts/backup-database.js [--output-directory=/private/path]');
	}
	const directory = path.resolve(args[0]?.slice('--output-directory='.length) || path.join(__dirname, '../.backups/database'));
	await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const destination = path.join(directory, 'mygigs-' + stamp + '.sql.gz');
	const temporary = destination + '.partial';
	const privateDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mygigs-backup-'));
	await fsp.chmod(privateDirectory, 0o700);
	let connection;
	let child;
	try {
		connection = await mysql.createConnection({ ...config.db, connectTimeout: 15000, dateStrings: true });
		const [[server]] = await connection.query('SELECT VERSION() AS version, DATABASE() AS name');
		const [tables] = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
		if (!tables.length || tables.some(table => table.engine !== 'InnoDB')) {
			throw new Error('A consistent online backup requires all base tables to use InnoDB.');
		}
		await connection.end();
		connection = null;
		const credentials = path.join(privateDirectory, 'client.cnf');
		const settings = { host: config.db.host, port: config.db.port || 3306, user: config.db.user, password: config.db.password || '', 'default-character-set': 'utf8mb4' };
		await fsp.writeFile(credentials, '[client]\n' + Object.entries(settings).map(([key, value]) => key + '=' + option(value)).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
		const executable = process.env.MYSQLDUMP_BIN || 'mysqldump';
		const flags = ['--defaults-file=' + credentials, '--single-transaction', '--quick', '--skip-lock-tables', '--no-tablespaces', '--set-gtid-purged=OFF', '--column-statistics=0', '--hex-blob', '--routines', '--events', '--triggers', '--skip-extended-insert', server.name];
		child = spawn(executable, flags, { stdio: ['ignore', 'pipe', 'pipe'] });
		// Error output can contain connection details; do not print it or credentials.
		child.stderr.resume();
		const completed = new Promise((resolve, reject) => {
			child.once('error', () => reject(new Error('Could not start mysqldump. Set MYSQLDUMP_BIN if necessary.')));
			child.once('close', code => code === 0 ? resolve() : reject(new Error('mysqldump failed with exit code ' + code + '. No backup was published.')));
		});
		await Promise.all([completed, pipeline(child.stdout, createGzip({ level: 9 }), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))]);

		const stream = fs.createReadStream(temporary).pipe(createGunzip());
		const rows = Object.fromEntries(tables.map(table => [table.name, 0]));
		const definitions = new Set();
		let footer = false;
		const streamFailure = new Promise((_, reject) => stream.once('error', reject));
		const inspect = (async () => {
			for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
				const definition = line.match(/^CREATE TABLE `((?:``|[^`])+)`/);
				if (definition) definitions.add(definition[1].replace(/``/g, '`'));
				const insert = line.match(/^INSERT INTO `((?:``|[^`])+)` /);
				if (insert) {
					const table = insert[1].replace(/``/g, '`');
					if (!(table in rows)) throw new Error('Unexpected table in backup.');
					rows[table]++;
				}
				if (line.startsWith('-- Dump completed on ')) footer = true;
			}
		})();
		await Promise.race([inspect, streamFailure]);
		if (!footer || definitions.size !== tables.length || tables.some(table => !definitions.has(table.name))) {
			throw new Error('Incomplete backup: missing table definitions or completion footer.');
		}
		const sha = crypto.createHash('sha256');
		for await (const chunk of fs.createReadStream(temporary)) sha.update(chunk);
		const bytes = (await fsp.stat(temporary)).size;
		const manifest = {
			created_at: new Date().toISOString(), database: server.name, server_version: server.version,
			backup_file: path.basename(destination), compressed_bytes: bytes, sha256: sha.digest('hex'),
			consistent_snapshot: true, table_count: tables.length, rows_by_table: rows,
			gzip_and_sql_structure_verified: true, isolated_restore_performed: false
		};
		await fsp.rename(temporary, destination);
		await fsp.writeFile(destination + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
		console.log(JSON.stringify({ backup: destination, compressed_bytes: bytes, tables: tables.length, rows: Object.values(rows).reduce((sum, count) => sum + count, 0), sha256: manifest.sha256, verification: 'gzip, table definitions, completion footer and SHA-256; no isolated restore' }, null, 2));
	} finally {
		if (child && child.exitCode === null) child.kill();
		if (connection) await connection.end();
		await fsp.rm(privateDirectory, { recursive: true, force: true });
		await fsp.rm(temporary, { force: true });
	}
}

main().catch(error => { console.error(error.code ? 'Backup failed (' + error.code + ').' : error.message); process.exitCode = 1; });
