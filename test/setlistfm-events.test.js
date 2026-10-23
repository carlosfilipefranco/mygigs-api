const { describe, test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const db = require("../services/db");
const { backfillMissingEvents } = require("../services/gigEvents");

// Simular apenas o setlist.fm. Todas as queries correm num MySQL de teste explícito.
let sourceEntries = [];
const fetchPath = require.resolve("node-fetch");
const originalFetch = require(fetchPath);
require.cache[fetchPath].exports = async () => ({ ok: true, status: 200, json: async () => ({ setlist: sourceEntries, total: sourceEntries.length, itemsPerPage: 20 }) });
const importer = require("../services/setlistFmImport");
require.cache[fetchPath].exports = originalFetch;

function entry(id, name = "Headliner", date = "21-10-2026") {
	return { id, eventDate: date, artist: { name, mbid: id },
		venue: { id: "venue-id", name: "Test Hall", city: { name: "Porto", country: { code: "PT" } } },
		url: `https://www.setlist.fm/setlist/${id}.html`, sets: { set: [{ song: [{ name: "Test song" }] }] } };
}

describe("setlist.fm event creation and missing-event repair", { skip: !process.env.MYSQL_TEST_SOCKET }, () => {
	const database = `mygigs_import_${process.pid}_${Date.now()}`;
	const originalQuery = db.query;
	const originalTransaction = db.transaction;
	let connection;
	const rows = async (sql, params) => (await connection.execute(sql, params))[0];
	const payload = { year: 2026, import_setlists: true };

	before(async () => {
		connection = await mysql.createConnection({ socketPath: process.env.MYSQL_TEST_SOCKET,
			user: process.env.MYSQL_TEST_USER || "root", password: process.env.MYSQL_TEST_PASSWORD || "", multipleStatements: true });
		await connection.query(`CREATE DATABASE \`${database}\``);
		await connection.query(`USE \`${database}\``);
		await connection.query(`
			CREATE TABLE artist (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), slug VARCHAR(191) UNIQUE, image VARCHAR(255), mbid VARCHAR(255), type INT DEFAULT 1);
			CREATE TABLE city (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), state VARCHAR(255));
			CREATE TABLE venue (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), city_id INT, lat VARCHAR(100), lng VARCHAR(100));
			CREATE TABLE gig (id INT AUTO_INCREMENT PRIMARY KEY, artist_id INT, venue_id INT, city_id INT, date DATE NULL, type INT DEFAULT 1, position INT DEFAULT 0, start_time TIME NULL, end_time TIME NULL);
			CREATE TABLE event (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), slug VARCHAR(191) UNIQUE, date DATE NULL, city_id INT, venue_id INT, type INT DEFAULT 1, image VARCHAR(255), description TEXT);
			CREATE TABLE event_gig (event_id INT, gig_id INT, stage_id INT NULL, start_time TIME NULL, end_time TIME NULL, PRIMARY KEY(event_id, gig_id), FOREIGN KEY(event_id) REFERENCES event(id), FOREIGN KEY(gig_id) REFERENCES gig(id));
			CREATE TABLE edition (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), date_start DATE, date_end DATE);
			CREATE TABLE edition_event (edition_id INT, event_id INT, PRIMARY KEY(edition_id, event_id));
			CREATE TABLE user_gig (user_id INT, gig_id INT, status ENUM('going','not_going'), favorite TINYINT DEFAULT 0, has_ticket TINYINT DEFAULT 0, UNIQUE(user_id, gig_id));
			CREATE TABLE user_event (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, event_id INT, status ENUM('wishlist','going','attended','missed'), has_ticket TINYINT DEFAULT 0, favorite TINYINT DEFAULT 0, UNIQUE(user_id, event_id));
			CREATE TABLE setlist (id INT AUTO_INCREMENT PRIMARY KEY, gig_id INT, artist_id INT);
			CREATE TABLE song (id INT AUTO_INCREMENT PRIMARY KEY, artist_id INT, name VARCHAR(255), UNIQUE(artist_id, name));
			CREATE TABLE setlist_song (setlist_id INT, song_id INT, position INT, encore INT);
		`);
		db.query = rows;
		db.transaction = async (callback) => {
			await connection.beginTransaction();
			try { const result = await callback(rows); await connection.commit(); return result; }
			catch (error) { await connection.rollback(); throw error; }
		};
	});

	beforeEach(async () => {
		await connection.query("SET FOREIGN_KEY_CHECKS=0");
		for (const table of ["artist", "city", "venue", "gig", "event", "event_gig", "edition", "edition_event", "user_gig", "user_event", "setlist", "song", "setlist_song"]) await connection.query(`TRUNCATE TABLE ${table}`);
		await connection.query("SET FOREIGN_KEY_CHECKS=1");
		await connection.query(`
			INSERT INTO artist (id, name, slug, image) VALUES (1, 'Headliner', 'headliner', 'https://example.com/artist.jpg'), (2, 'Support', 'support', NULL);
			INSERT INTO city (id, name) VALUES (1, 'Porto');
			INSERT INTO venue (id, name, city_id) VALUES (1, 'Test Hall', 1);
		`);
		sourceEntries = [entry("one")];
	});

	after(async () => {
		db.query = originalQuery;
		db.transaction = originalTransaction;
		if (connection) {
			try { await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); }
			finally { await connection.end(); }
		}
	});

	test("creates the concert, event, link and setlist in one import", async () => {
		const result = await importer.importEntries(payload);
		assert.equal(result.summary.created_gigs, 1);
		assert.equal(result.summary.created_events, 1);
		assert.equal(result.summary.linked_events, 1);
		assert.equal(result.summary.created_setlists, 1);
		assert.ok(result.results[0].event_id);
		const events = await rows("SELECT name, DATE_FORMAT(date, '%Y-%m-%d') AS date, image FROM event");
		assert.deepEqual(events, [{ name: "Headliner", date: "2026-10-21", image: "https://example.com/artist.jpg" }]);
	});

	test("groups artists from the same day and venue and remains idempotent", async () => {
		sourceEntries = [entry("one"), entry("two", "Support")];
		const first = await importer.importEntries(payload);
		assert.equal(first.summary.created_events, 1);
		assert.equal(first.summary.linked_events, 2);
		assert.equal(first.results[0].event_id, first.results[1].event_id);
		assert.equal((await rows("SELECT name FROM event"))[0].name, "Headliner + Support");
		assert.equal((await rows("SELECT image FROM event"))[0].image, null);
		const again = await importer.importEntries(payload);
		assert.equal(again.summary.created_events, 0);
		assert.equal(again.summary.created_gigs, 0);
		assert.equal(again.summary.linked_events, 0);
		assert.equal(again.summary.created_setlists, 0);
		assert.equal((await rows("SELECT * FROM event_gig")).length, 2);
	});

	test("repairs an existing orphan and transfers attendance without changing concert data", async () => {
		await rows("INSERT INTO gig (id, artist_id, city_id, venue_id, date, start_time) VALUES (10, 1, 1, 1, '2026-10-21', '21:30:00')");
		await rows("INSERT INTO user_gig (user_id,gig_id,status,favorite,has_ticket) VALUES (1,10,'going',1,1),(2,10,'not_going',0,0)");
		const result = await importer.importEntries(payload);
		assert.equal(result.summary.existing_gigs, 1);
		assert.equal(result.summary.created_events, 1);
		assert.equal((await rows("SELECT start_time FROM event_gig"))[0].start_time, "21:30:00");
		assert.deepEqual(await rows("SELECT user_id,status,has_ticket FROM user_event"), [{ user_id: 1, status: "attended", has_ticket: 1 }]);
		assert.equal((await rows("SELECT favorite FROM user_gig WHERE user_id=1"))[0].favorite, 1);
	});

	test("reuses a unique matching event while preserving explicit user event preferences", async () => {
		await rows("INSERT INTO event (id,name,slug,date,city_id,venue_id,type) VALUES (5,'Existing','existing','2026-10-21',1,1,1)");
		await rows("INSERT INTO gig (id,artist_id,city_id,venue_id,date) VALUES (10,1,1,1,'2026-10-21')");
		await rows("INSERT INTO user_gig (user_id,gig_id,status) VALUES (1,10,'going')");
		await rows("INSERT INTO user_event (user_id,event_id,status,has_ticket,favorite) VALUES (1,5,'wishlist',1,1)");
		const result = await importer.importEntries(payload);
		assert.equal(result.summary.created_events, 0);
		assert.equal(result.results[0].event_id, 5);
		assert.deepEqual(await rows("SELECT status,has_ticket,favorite FROM user_event"), [{ status: "wishlist", has_ticket: 1, favorite: 1 }]);
	});

	test("creates distinct events and unique slugs for different dates", async () => {
		sourceEntries = [entry("one"), entry("two", "Headliner", "22-10-2026")];
		const result = await importer.importEntries(payload);
		assert.equal(result.summary.created_events, 2);
		assert.deepEqual((await rows("SELECT slug FROM event ORDER BY id")).map((event) => event.slug), ["headliner", "headliner-2"]);
	});

	test("rolls back new concerts when matching events are ambiguous", async () => {
		await rows("INSERT INTO event (name,date,city_id,venue_id,type) VALUES ('First','2026-10-21',1,1,1),('Second','2026-10-21',1,1,1)");
		await assert.rejects(importer.importEntries(payload), /vários eventos/);
		assert.equal((await rows("SELECT * FROM gig")).length, 0);
		assert.equal((await rows("SELECT * FROM event_gig")).length, 0);
	});

	test("honours an explicitly selected event and rejects missing destinations", async () => {
		await assert.rejects(importer.importEntries({ ...payload, event_id: 999 }), /destino não encontrado/);
		assert.equal((await rows("SELECT * FROM gig")).length, 0);
		await rows("INSERT INTO event (id,name,date,city_id,venue_id) VALUES (5,'Chosen','2026-10-21',1,1)");
		const result = await importer.importEntries({ ...payload, event_id: 5 });
		assert.equal(result.results[0].event_id, 5);
		assert.equal(result.summary.created_events, 0);
	});

	test("preserves festival edition grouping and its links on subsequent default imports", async () => {
		await rows("INSERT INTO edition (id,name) VALUES (3,'Festival 2026')");
		sourceEntries = [entry("one"), entry("two", "Support")];
		const result = await importer.importEntries({ ...payload, edition_id: 3 });
		assert.equal(result.summary.created_events, 1);
		assert.equal((await rows("SELECT * FROM edition_event")).length, 1);
		assert.equal((await rows("SELECT DATE_FORMAT(date_start,'%Y-%m-%d') AS date FROM edition"))[0].date, "2026-10-21");
		const again = await importer.importEntries(payload);
		assert.equal(again.summary.created_events, 0);
		assert.equal(again.results[0].event_id, result.results[0].event_id);
	});

	test("backfill previews without writing, separates undated gigs and is safe to repeat", async () => {
		await rows("INSERT INTO gig (artist_id,city_id,venue_id,date) VALUES (1,1,1,'2026-10-21'),(2,1,1,'2026-10-21'),(1,1,1,NULL),(1,1,1,NULL)");
		const preview = await backfillMissingEvents();
		assert.equal(preview.summary.missing_gigs, 4);
		assert.equal(preview.summary.planned_events, 3);
		assert.equal(preview.summary.undated_gigs, 2);
		assert.equal((await rows("SELECT * FROM event")).length, 0);
		let backupDone = false;
		const result = await backfillMissingEvents({ apply: true, beforeApply: async (snapshot) => { assert.equal(snapshot.gigs.length, 4); backupDone = true; } });
		assert.ok(backupDone);
		assert.equal(result.summary.created_events, 3);
		assert.equal(result.summary.linked_gigs, 4);
		assert.equal((await rows("SELECT * FROM event WHERE date IS NULL")).length, 2);
		const again = await backfillMissingEvents({ apply: true });
		assert.equal(again.summary.missing_gigs, 0);
		assert.equal((await rows("SELECT * FROM event")).length, 3);
	});

	test("backup failure aborts before changing any data", async () => {
		await rows("INSERT INTO gig (artist_id,city_id,venue_id,date) VALUES (1,1,1,'2026-10-21')");
		await assert.rejects(backfillMissingEvents({ apply: true, beforeApply: async () => { throw new Error("Backup failed"); } }), /Backup failed/);
		assert.equal((await rows("SELECT * FROM event")).length, 0);
		assert.equal((await rows("SELECT * FROM event_gig")).length, 0);
	});

	test("preview identifies concerts that still need an event", async () => {
		await rows("INSERT INTO gig (artist_id,city_id,venue_id,date) VALUES (1,1,1,'2026-10-21')");
		const before = await importer.preview(payload);
		assert.equal(before.entries[0].event_exists, false);
		await importer.importEntries(payload);
		const after = await importer.preview(payload);
		assert.equal(after.entries[0].event_exists, true);
		assert.ok(after.entries[0].existing_event_id);
	});
});
