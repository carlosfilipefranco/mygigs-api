const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { backfillMissingEvents } = require("../services/gigEvents");

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log("Usage: node scripts/backfill-gig-events.js [--dry-run | --apply] [--backup=/path/backup.json]");
		return;
	}
	const apply = args.includes("--apply");
	if (apply && args.includes("--dry-run")) throw new Error("Escolhe --dry-run ou --apply.");
	const backupArg = args.find((arg) => arg.startsWith("--backup="));
	const backupPath = backupArg ? path.resolve(backupArg.slice("--backup=".length)) : path.join(os.tmpdir(), `mygigs-before-gig-events-${Date.now()}.json`);
	const result = await backfillMissingEvents({
		apply,
		beforeApply: async (snapshot) => {
			await fs.writeFile(backupPath, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: "wx" });
			console.log(`Backup: ${backupPath}`);
		}
	});
	console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
	console.error(error.message);
	process.exit(1);
});
