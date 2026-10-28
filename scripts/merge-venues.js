const fs = require("node:fs/promises");
const path = require("node:path");
const { merge } = require("../services/venue");

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log("Usage: node scripts/merge-venues.js --source=ID --target=ID [--apply] [--backup=PATH]");
		return;
	}
	const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
	const source = Number(value("source")), target = Number(value("target"));
	if (!Number.isInteger(source) || source <= 0 || !Number.isInteger(target) || target <= 0) throw new Error("Indica os IDs de origem e destino.");
	const apply = args.includes("--apply");
	const backupPath = value("backup") ? path.resolve(value("backup")) : path.join(__dirname, "../.secrets", `venue-merge-${source}-into-${target}-${Date.now()}.json`);
	const result = await merge(source, target, {
		apply,
		beforeApply: async snapshot => {
			await fs.mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
			await fs.writeFile(backupPath, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: "wx" });
			console.log(`Backup: ${backupPath}`);
		}
	});
	console.log(JSON.stringify({ apply, ...result }, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message);process.exit(1); });
