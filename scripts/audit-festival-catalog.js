// Read-only catalogue inventory. Does not infer historical completeness from row counts.
// Usage: node scripts/audit-festival-catalog.js [--output=path.json] [--user-id=123 | --user-email=address]
const mysql = require('mysql2/promise');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

async function main() {
	const args = process.argv.slice(2);
	if (args.some(arg => !/^--(?:output=.+|user-id=[1-9]\d*|user-email=[^\s@]+@[^\s@]+)$/.test(arg))) {
		throw new Error('Usage: node scripts/audit-festival-catalog.js [--output=path.json] [--user-id=123 | --user-email=address]');
	}
	const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
	let userId = Number(args.find(arg => arg.startsWith('--user-id='))?.slice(10)) || null;
	const userEmail = args.find(arg => arg.startsWith('--user-email='))?.slice(13);
	if (userEmail && userId) throw new Error('Choose either user-id or user-email.');
	const connection = await mysql.createConnection({ ...config.db, connectTimeout: 15000, dateStrings: true });
	try {
		await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
		await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
		const query = async (sql, params = []) => (await connection.execute({ sql, timeout: 30000 }, params))[0];
		if (userEmail) {
			const users = await query('SELECT id FROM user WHERE email = ?', [userEmail]);
			if (users.length !== 1) throw new Error('History account not found or ambiguous.');
			userId = users[0].id;
		}
		const totals = (await query(`SELECT
			(SELECT COUNT(*) FROM festival) AS festivals,
			(SELECT COUNT(*) FROM edition) AS editions,
			(SELECT COUNT(*) FROM event) AS events,
			(SELECT COUNT(*) FROM gig WHERE type = 1) AS music_gigs,
			(SELECT COUNT(*) FROM artist WHERE type = 1) AS music_artists`))[0];
		const festivals = await query('SELECT id, name, slug, image FROM festival ORDER BY name, id');
		const editions = await query(`SELECT ed.id, ed.festival_id, ed.name, ed.slug, ed.date_start, ed.date_end,
			ed.dates_confirmed, ed.venue_id, ed.city_id,
			(NULLIF(TRIM(ed.image), '') IS NOT NULL) AS has_image,
			v.name AS venue, c.name AS city, c.country_code,
			COUNT(DISTINCT e.id) AS events, COUNT(DISTINCT g.id) AS gigs,
			COUNT(DISTINCT g.artist_id) AS artists, COUNT(DISTINCT g.date) AS days_with_gigs,
			MIN(g.date) AS first_gig, MAX(g.date) AS last_gig,
			COUNT(DISTINCT CASE WHEN g.date IS NULL THEN g.id END) AS gigs_without_date,
			COUNT(DISTINCT CASE WHEN eg.stage_id IS NULL THEN g.id END) AS gigs_without_stage,
			COUNT(DISTINCT CASE WHEN COALESCE(eg.start_time, g.start_time) IS NULL THEN g.id END) AS gigs_without_time,
			COUNT(DISTINCT CASE WHEN e.date < ed.date_start OR e.date > ed.date_end THEN e.id END) AS events_outside_dates,
			COUNT(DISTINCT CASE WHEN NOT (g.date <=> e.date) THEN g.id END) AS gig_event_date_mismatches,
			COUNT(DISTINCT CASE WHEN g.date < ed.date_start OR g.date > ed.date_end THEN g.id END) AS gigs_outside_dates
			FROM edition ed LEFT JOIN venue v ON v.id = ed.venue_id LEFT JOIN city c ON c.id = ed.city_id
			LEFT JOIN edition_event ee ON ee.edition_id = ed.id LEFT JOIN event e ON e.id = ee.event_id
			LEFT JOIN event_gig eg ON eg.event_id = e.id LEFT JOIN gig g ON g.id = eg.gig_id
			GROUP BY ed.id, ed.festival_id, ed.name, ed.slug, ed.date_start, ed.date_end,
				ed.dates_confirmed, ed.venue_id, ed.city_id, ed.image, v.name, c.name, c.country_code ORDER BY ed.festival_id, ed.date_start, ed.id`);
		const integrity = {};
		const checks = {
			orphan_edition_events: `SELECT ee.* FROM edition_event ee LEFT JOIN edition ed ON ed.id=ee.edition_id LEFT JOIN event e ON e.id=ee.event_id WHERE ed.id IS NULL OR e.id IS NULL`,
			orphan_event_gigs: `SELECT eg.event_id, eg.gig_id FROM event_gig eg LEFT JOIN event e ON e.id=eg.event_id LEFT JOIN gig g ON g.id=eg.gig_id WHERE e.id IS NULL OR g.id IS NULL`,
			events_in_multiple_editions: `SELECT event_id, COUNT(DISTINCT edition_id) AS editions FROM edition_event GROUP BY event_id HAVING COUNT(DISTINCT edition_id)>1`,
			gigs_in_multiple_events: `SELECT gig_id, COUNT(DISTINCT event_id) AS events FROM event_gig GROUP BY gig_id HAVING COUNT(DISTINCT event_id)>1`,
			duplicate_festival_names: `SELECT LOWER(TRIM(name)) AS name, COUNT(*) AS count FROM festival GROUP BY LOWER(TRIM(name)) HAVING COUNT(*)>1`,
			duplicate_edition_names: `SELECT festival_id, LOWER(TRIM(name)) AS name, COUNT(*) AS count FROM edition GROUP BY festival_id, LOWER(TRIM(name)) HAVING COUNT(*)>1`,
			duplicate_gigs: `SELECT artist_id, venue_id, date, type, COUNT(*) AS count FROM gig WHERE date IS NOT NULL GROUP BY artist_id, venue_id, date, type HAVING COUNT(*)>1`,
			gigs_without_event: `SELECT COUNT(*) AS count FROM gig g WHERE NOT EXISTS (SELECT 1 FROM event_gig eg WHERE eg.gig_id=g.id)`,
			invalid_edition_references: `SELECT ed.id, ed.name FROM edition ed LEFT JOIN festival f ON f.id=ed.festival_id LEFT JOIN venue v ON v.id=ed.venue_id LEFT JOIN city c ON c.id=ed.city_id WHERE f.id IS NULL OR v.id IS NULL OR c.id IS NULL`,
			invalid_stages: `SELECT eg.event_id, eg.gig_id, eg.stage_id FROM event_gig eg LEFT JOIN event_stage es ON es.id=eg.stage_id WHERE eg.stage_id IS NOT NULL AND (es.id IS NULL OR es.event_id<>eg.event_id)`
		};
		// Multi-venue festivals may legitimately differ; these rows require review.
		checks.edition_event_location_differences = `SELECT ed.id AS edition_id, ed.name, e.id AS event_id,
			ed.venue_id AS edition_venue_id, e.venue_id AS event_venue_id, ed.city_id AS edition_city_id, e.city_id AS event_city_id
			FROM edition ed JOIN edition_event ee ON ee.edition_id=ed.id JOIN event e ON e.id=ee.event_id
			WHERE NOT(ed.venue_id <=> e.venue_id) OR NOT(ed.city_id <=> e.city_id) ORDER BY ed.id,e.id`;
		checks.edition_gig_location_differences = `SELECT ed.id AS edition_id, ed.name,
			ed.venue_id AS edition_venue_id, g.venue_id AS gig_venue_id, ed.city_id AS edition_city_id, g.city_id AS gig_city_id,
			COUNT(DISTINCT g.id) AS gigs FROM edition ed JOIN edition_event ee ON ee.edition_id=ed.id
			JOIN event_gig eg ON eg.event_id=ee.event_id JOIN gig g ON g.id=eg.gig_id
			WHERE NOT(ed.venue_id <=> g.venue_id) OR NOT(ed.city_id <=> g.city_id)
			GROUP BY ed.id,ed.name,ed.venue_id,g.venue_id,ed.city_id,g.city_id ORDER BY ed.id,g.venue_id,g.city_id`;
		for (const [name, sql] of Object.entries(checks)) integrity[name] = await query(sql);
		const dateIssues = await query(`SELECT ed.id AS edition_id, ed.name AS edition, e.id AS event_id,
			e.date AS event_date, g.id AS gig_id, a.name AS artist, g.date AS gig_date, ed.date_start, ed.date_end,
			ed.dates_confirmed, v.name AS venue
			FROM edition ed INNER JOIN edition_event ee ON ee.edition_id=ed.id INNER JOIN event e ON e.id=ee.event_id
			INNER JOIN event_gig eg ON eg.event_id=e.id INNER JOIN gig g ON g.id=eg.gig_id
			INNER JOIN artist a ON a.id=g.artist_id LEFT JOIN venue v ON v.id=g.venue_id
			WHERE NOT (g.date <=> e.date) OR e.date < ed.date_start OR e.date > ed.date_end
			OR g.date < ed.date_start OR g.date > ed.date_end ORDER BY ed.id, g.date, g.id`);
		let history = null;
		if (userId) {
			history = await query(`SELECT f.id AS festival_id, f.name AS festival,
				COUNT(DISTINCT ed.id) AS editions, COUNT(DISTINCT g.id) AS gigs,
				MIN(g.date) AS first_gig, MAX(g.date) AS last_gig,
				GROUP_CONCAT(DISTINCT ed.name ORDER BY ed.name SEPARATOR ' | ') AS edition_names
				FROM user_gig ug INNER JOIN gig g ON g.id=ug.gig_id
				INNER JOIN event_gig eg ON eg.gig_id=g.id INNER JOIN edition_event ee ON ee.event_id=eg.event_id
				INNER JOIN edition ed ON ed.id=ee.edition_id INNER JOIN festival f ON f.id=ed.festival_id
				WHERE ug.user_id=? AND ug.status='going' AND g.type=1 AND g.date<CURDATE()
				GROUP BY f.id, f.name ORDER BY editions DESC, f.name`, [userId]);
		}
		const indexes = await query(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
			GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list
			FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
			AND TABLE_NAME IN ('festival','edition','edition_event','event','event_gig','gig','artist')
			GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`);
		const foreignKeys = await query(`SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
			FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
			AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, COLUMN_NAME`);
		await connection.rollback();
		const report = {
			generated_at: new Date().toISOString(), scope: 'Existing festivals; all historical editions requested',
			limitations: [
				'Row counts and calendar gaps do not prove completeness or that an edition took place.',
				'Cancelled, postponed and non-annual editions need external source verification.',
				'Stage and time omissions are enrichment gaps, not necessarily launch blockers.',
				'Personal history, when requested, follows the application: past music gigs with user_gig.status=going.'
			], totals,
			festivals: festivals.map(f => {
				const rows = editions.filter(ed => ed.festival_id === f.id);
				const years = [...new Set(rows.map(ed => Number(ed.name.match(/\b((?:19|20)\d{2})\b/)?.[1] || ed.date_start?.slice(0, 4))).filter(Boolean))].sort((a,b)=>a-b);
				const gaps = [];
				for (let year = years[0]; year < years[years.length - 1]; year++) if (!years.includes(year)) gaps.push(year);
				return { ...f, country_codes: [...new Set(rows.map(ed => ed.country_code).filter(Boolean))].sort(),
					editions: rows.length, gigs: rows.reduce((sum, ed) => sum + Number(ed.gigs), 0),
					empty_editions: rows.filter(ed => !Number(ed.gigs)).map(ed => ({ id: ed.id, name: ed.name })),
					years_present: years, calendar_gaps_to_verify: gaps };
			}), editions, integrity, date_issues: dateIssues, indexes, foreign_keys: foreignKeys, personal_festival_history: history
		};
		if (output) {
			await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
			await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
			console.log(JSON.stringify({ output: path.resolve(output), totals, empty_editions: editions.filter(ed => !Number(ed.gigs)).length }));
		} else console.log(JSON.stringify(report, null, 2));
	} finally {
		await connection.end();
	}
}

main().catch(error => {
	console.error(`Catalogue audit failed: ${error.code || error.name || 'Unknown error'}`);
	process.exitCode = 1;
});
