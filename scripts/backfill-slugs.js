const db = require("../services/db");
const { buildUniqueSlug } = require("../services/slug");

const TABLE_CONFIG = {
	artist: { sourceColumn: "name" },
	event: { sourceColumn: "name" },
	festival: { sourceColumn: "name" },
	edition: { sourceColumn: "name" }
};

const args = process.argv.slice(2);
const showHelp = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");
const rebuildAll = args.includes("--rebuild");
const tableArg = args.find((arg) => arg.startsWith("--tables="));
const requestedTables = tableArg
	? tableArg
		.split("=")[1]
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean)
	: Object.keys(TABLE_CONFIG);

function printHelp() {
	console.log(`
Usage:
  node scripts/backfill-slugs.js [options]

Options:
  --dry-run             Mostra o que seria atualizado sem gravar na BD.
  --rebuild             Recalcula slugs para todos os registos (por omissão só preenche os em falta).
  --tables=a,b,c        Tabelas a processar (artist,event,festival,edition).
  -h, --help            Mostra esta ajuda.

Examples:
  node scripts/backfill-slugs.js --dry-run
  node scripts/backfill-slugs.js --tables=artist,event
  node scripts/backfill-slugs.js --rebuild
`);
}

function validateTables(tables) {
	const valid = Object.keys(TABLE_CONFIG);
	const invalid = tables.filter((table) => !valid.includes(table));
	if (invalid.length) {
		throw new Error(`Invalid table(s): ${invalid.join(", ")}. Valid: ${valid.join(", ")}`);
	}
}

function getFallbackName(table, id) {
	return `${table}-${id}`;
}

async function processTable(tableName) {
	const { sourceColumn } = TABLE_CONFIG[tableName];
	const whereClause = rebuildAll ? "" : "WHERE slug IS NULL OR slug = ''";
	const rows = await db.query(
		`SELECT id, ${sourceColumn} AS source_value, slug FROM ${tableName} ${whereClause} ORDER BY id ASC`
	);

	console.log(`[${tableName}] found ${rows.length} row(s) to process`);

	let updated = 0;
	let unchanged = 0;

	for (const row of rows) {
		const sourceValue = row.source_value || getFallbackName(tableName, row.id);
		const newSlug = await buildUniqueSlug(db, tableName, sourceValue, row.id);
		const currentSlug = (row.slug || "").trim();

		if (currentSlug === newSlug) {
			unchanged += 1;
			continue;
		}

		if (dryRun) {
			console.log(`[${tableName}] would update id=${row.id}: "${currentSlug}" -> "${newSlug}"`);
			updated += 1;
			continue;
		}

		await db.query(`UPDATE ${tableName} SET slug = ? WHERE id = ?`, [newSlug, row.id]);
		updated += 1;
	}

	return { total: rows.length, updated, unchanged };
}

async function run() {
	if (showHelp) {
		printHelp();
		process.exit(0);
	}

	validateTables(requestedTables);

	const summary = {};
	for (const table of requestedTables) {
		summary[table] = await processTable(table);
	}

	console.log("\nSummary");
	for (const table of requestedTables) {
		const result = summary[table];
		console.log(
			`- ${table}: total=${result.total}, updated=${result.updated}, unchanged=${result.unchanged}`
		);
	}
}

run()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
