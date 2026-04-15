const db = require("../services/db");
const { getExistingRelativeImagePath, isRemoteImage, publicUploadPath, storeEventImage, uploadRoot } = require("../services/eventImageStorage");

const args = process.argv.slice(2);
const showHelp = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");
const overwrite = args.includes("--overwrite");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

if (showHelp) {
	console.log(`
Usage:
  npm run download:event-images -- [options]

Options:
  --dry-run       Lists what would be downloaded without writing files or updating the database.
  --limit=N       Processes at most N events.
  --overwrite     Replaces existing local files with the same generated filename.

Examples:
  npm run download:event-images -- --dry-run --limit=10
  npm run download:event-images
`);
	process.exit(0);
}

async function updateEventImage(event, image) {
	if (dryRun) {
		console.log(`would update #${event.id} ${event.name}: ${event.image} -> ${image}`);
		return true;
	}

	await db.query("UPDATE event SET image=? WHERE id=?", [image, event.id]);
	return true;
}

async function run() {
	let sql = `
		SELECT id, name, image
		FROM event
		WHERE image IS NOT NULL
			AND image <> ''
			AND image <> 'null'
		ORDER BY id
	`;

	if (Number.isInteger(limit) && limit > 0) {
		sql += ` LIMIT ${limit}`;
	}

	const events = await db.query(sql);
	let downloaded = 0;
	let normalized = 0;
	let skipped = 0;
	let failed = 0;

	console.log(`Found ${events.length} events with image`);
	console.log(`Uploads: ${uploadRoot}`);
	console.log(`Database image path: ${publicUploadPath}/...`);
	if (dryRun) {
		console.log("Dry run: no files will be written and the database will not be updated");
	}

	for (const event of events) {
		const localImagePath = getExistingRelativeImagePath(event.image);
		if (localImagePath) {
			if (event.image !== localImagePath) {
				await updateEventImage(event, localImagePath);
				normalized++;
				console.log(`normalized #${event.id} ${event.name}: ${localImagePath}`);
			} else {
				skipped++;
				console.log(`skip #${event.id} ${event.name}: already local`);
			}
			continue;
		}

		if (!isRemoteImage(event.image)) {
			skipped++;
			console.log(`skip #${event.id} ${event.name}: unsupported image URL`);
			continue;
		}

		try {
			if (dryRun) {
				console.log(`would download #${event.id} ${event.name}: ${event.image}`);
				downloaded++;
				continue;
			}

			const result = await storeEventImage({ id: event.id, name: event.name, image: event.image, overwrite });
			await updateEventImage(event, result.image);
			downloaded++;

			const detail = result.skippedExistingFile ? "existing file" : `${Math.round((result.size || 0) / 1024)} KB`;
			console.log(`ok #${event.id} ${event.name}: ${result.image} (${detail})`);
		} catch (error) {
			failed++;
			console.error(`fail #${event.id} ${event.name}: ${error.message}`);
		}
	}

	console.log(`Done. downloaded=${downloaded} normalized=${normalized} skipped=${skipped} failed=${failed}`);
}

run()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
