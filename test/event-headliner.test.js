const { describe, test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const db = require("../services/db");
const events = require("../services/event");
const migration = fs.readFileSync(path.join(__dirname, "../migrations/20261023_add_event_headliner.sql"), "utf8");

// Apenas uma base de dados descartável indicada explicitamente, sem usar a config real.
describe("event headliners", { skip: !process.env.MYSQL_TEST_SOCKET }, () => {
	const database = `mygigs_headliner_${process.pid}_${Date.now()}`;
	const originalQuery = db.query, originalTransaction = db.transaction;
	let connection;
	const query = async (sql, params) => (await connection.execute(sql, params))[0];
	const payload = (extra = {}) => ({ date: "2026-10-23", city_id: 1, venue_id: 1, type: 1,
		artists: [{ artist_id: 2, start_time: "20:00", stage_name: "Sala" }, { artist_id: 1, start_time: "22:00", stage_name: "Sala" }], headliner_artist_id: 1, ...extra });
	const editPayload = (extra = {}) => ({ name: "Concert", image: null, description: null, ...extra });
	before(async () => {
		connection = await mysql.createConnection({ socketPath: process.env.MYSQL_TEST_SOCKET, user: process.env.MYSQL_TEST_USER || "root", password: process.env.MYSQL_TEST_PASSWORD || "", multipleStatements: true });
		await connection.query(`CREATE DATABASE \`${database}\`; USE \`${database}\`;
			CREATE TABLE artist (id INT PRIMARY KEY, name VARCHAR(255), slug VARCHAR(191), image VARCHAR(255));
			CREATE TABLE city (id INT PRIMARY KEY, name VARCHAR(255));
			CREATE TABLE venue (id INT PRIMARY KEY, name VARCHAR(255));
			CREATE TABLE event (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), slug VARCHAR(191) UNIQUE, date DATE, city_id INT, venue_id INT, type INT, image VARCHAR(255), description TEXT);
			CREATE TABLE gig (id INT AUTO_INCREMENT PRIMARY KEY, date DATE, city_id INT, venue_id INT, type INT, artist_id INT, start_time TIME, end_time TIME, FOREIGN KEY(artist_id) REFERENCES artist(id));
			CREATE TABLE event_stage (id INT AUTO_INCREMENT PRIMARY KEY, event_id INT, name VARCHAR(255), position INT);
			CREATE TABLE event_gig (event_id INT, gig_id INT, stage_id INT, start_time TIME, end_time TIME, PRIMARY KEY(event_id, gig_id));
			CREATE TABLE edition (id INT PRIMARY KEY, date_start DATE, date_end DATE);
			CREATE TABLE edition_event (event_id INT, edition_id INT, FOREIGN KEY(edition_id) REFERENCES edition(id));
			CREATE TABLE user_event (event_id INT, user_id INT, status VARCHAR(20), has_ticket TINYINT, favorite TINYINT);
			CREATE TABLE user_gig (gig_id INT, user_id INT, status VARCHAR(20), favorite TINYINT);
		`);
		await connection.query(migration);
		db.query = query;
		db.transaction = async (callback) => {
			await connection.beginTransaction();
			try { const result = await callback(query); await connection.commit(); return result; }
			catch (error) { await connection.rollback(); throw error; }
		};
	});
	beforeEach(async () => {
		await connection.query("SET FOREIGN_KEY_CHECKS=0");
		for (const table of ["event", "gig", "event_gig", "event_stage", "edition", "edition_event", "artist", "city", "venue", "user_event", "user_gig"]) await connection.query(`TRUNCATE TABLE ${table}`);
		await connection.query(`SET FOREIGN_KEY_CHECKS=1;
			INSERT INTO artist VALUES (1,'Z Headliner','z-headliner',NULL),(2,'A Support','a-support',NULL),(3,'Other artist','other',NULL);
			INSERT INTO city VALUES (1,'Porto'); INSERT INTO venue VALUES (1,'Hall'); INSERT INTO edition(id) VALUES (1);`);
	});
	after(async () => {
		db.query = originalQuery; db.transaction = originalTransaction;
		if (connection) {
			try { await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); }
			finally { await connection.end(); }
		}
	});

	test("persists the chosen headliner, uses its name and puts it before earlier support acts", async () => {
		const { id } = await events.create(payload());
		const event = await events.get(id);
		assert.equal(event.name, "Z Headliner");
		assert.equal(event.headliner_artist_id, 1);
		assert.deepEqual(event.gigs.map((gig) => [gig.artist_id, gig.is_headliner, gig.start_time]), [[1, true, "22:00:00"], [2, false, "20:00:00"]]);
		assert.equal(event.gigs[0].stage_name, "Sala");
	});
	test("keeps a supplied event name and supports switching the headliner on edit", async () => {
		const { id } = await events.create(payload({ name: "Tour name" }));
		assert.equal((await events.get(id)).name, "Tour name");
		await events.update(id, editPayload({ headliner_artist_id: 2 }));
		const event = await events.get(id);
		assert.equal(event.headliner_artist_id, 2);
		assert.deepEqual(event.gigs.map((gig) => gig.artist_id), [2, 1]);
	});
	test("can select an artist added in the same edit and retains it when omitted later", async () => {
		const { id } = await events.create(payload());
		await events.update(id, editPayload({ artists: [{ artist_id: 3 }], headliner_artist_id: 3 }));
		await events.update(id, editPayload());
		assert.equal((await events.get(id)).gigs[0].artist_id, 3);
	});
	test("allows clearing the headliner without inventing one for a multi-artist event", async () => {
		const { id } = await events.create(payload());
		await events.update(id, editPayload({ headliner_artist_id: null }));
		const event = await events.get(id);
		assert.equal(event.headliner_artist_id, null);
		assert.ok(event.gigs.every((gig) => !gig.is_headliner));
	});
	test("does not infer legacy multi-artist headliners and derives single-artist ones", async () => {
		const unknown = payload(); delete unknown.headliner_artist_id;
		const first = await events.create(unknown);
		assert.equal((await events.get(first.id)).headliner_artist_id, null);
		assert.equal((await events.get(first.id)).name, "A Support + Z Headliner");
		const second = await events.create(payload({ artists: [{ artist_id: 1 }], headliner_artist_id: null }));
		assert.equal((await events.get(second.id)).gigs[0].is_headliner, true);
	});
	test("rejects artists outside the lineup and invalid IDs without modifying data", async () => {
		for (const headliner_artist_id of [3, -1, "abc", 1.5, true]) {
			await assert.rejects(events.create(payload({ headliner_artist_id })), { statusCode: 400 });
		}
		assert.equal((await query("SELECT COUNT(*) AS count FROM event"))[0].count, 0);
		const { id } = await events.create(payload());
		await assert.rejects(events.update(id, editPayload({ headliner_artist_id: 3 })), { statusCode: 400 });
		assert.equal((await events.get(id)).headliner_artist_id, 1);
		assert.equal((await events.get(id)).name, "Z Headliner");
	});
	test("rejects repeated artists during creation", async () => {
		await assert.rejects(events.create(payload({ artists: [{ artist_id: 1 }, { artist_id: 1 }] })), { statusCode: 400 });
		assert.equal((await query("SELECT COUNT(*) AS count FROM event"))[0].count, 0);
	});
	test("ignores billing in festivals and keeps chronological order and edition dates", async () => {
		const { id } = await events.create(payload({ edition: 1 }));
		await events.update(id, editPayload({ headliner_artist_id: 1 }));
		const event = await events.get(id);
		assert.equal(event.is_festival, true);
		assert.equal(event.headliner_artist_id, null);
		assert.deepEqual(event.gigs.map((gig) => gig.artist_id), [2, 1]);
		assert.ok(event.gigs.every((gig) => !gig.is_headliner));
		assert.equal((await query("SELECT DATE_FORMAT(date_start, '%Y-%m-%d') AS date FROM edition"))[0].date, "2026-10-23");
	});
	test("keeps theatre ordering and omits headliner badges", async () => {
		const { id } = await events.create(payload({ name: "Play", type: 2 }));
		const event = await events.get(id);
		assert.equal(event.headliner_artist_id, null);
		assert.deepEqual(event.gigs.map((gig) => gig.artist_id), [2, 1]);
	});
	test("rolls back event and concerts when creation fails after the event insert", async () => {
		await assert.rejects(events.create(payload({ edition: 999 })));
		for (const table of ["event", "gig", "event_gig", "event_stage"]) assert.equal((await query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count, 0);
	});
	test("rejects updates to concerts belonging to another event", async () => {
		const first = await events.create(payload());
		const second = await events.create(payload());
		const secondGig = (await events.get(second.id)).gigs[0];
		await assert.rejects(events.update(first.id, editPayload({ gigs: [{ id: secondGig.id, start_time: "12:00" }] })), { statusCode: 400 });
		assert.equal((await events.get(first.id)).name, "Z Headliner");
		assert.equal((await events.get(second.id)).gigs[0].start_time, "22:00:00");
	});
	test("rolls back metadata and billing on a later invalid new artist", async () => {
		const { id } = await events.create(payload());
		await assert.rejects(events.update(id, editPayload({ headliner_artist_id: 2, artists: [{ artist_id: 999 }] })));
		const event = await events.get(id);
		assert.equal(event.name, "Z Headliner"); assert.equal(event.headliner_artist_id, 1); assert.equal(event.gigs.length, 2);
	});
	test("migration is repeatable and preserves existing choices", async () => {
		const { id } = await events.create(payload());
		await connection.query(migration); await connection.query(migration);
		assert.equal((await events.get(id)).headliner_artist_id, 1);
	});
	test("migration handles a pre-existing column and nulls references on artist deletion", async () => {
		await connection.query("ALTER TABLE event DROP FOREIGN KEY event_headliner_artist_fk, DROP INDEX event_headliner_artist_idx");
		await connection.query(migration);
		await query("INSERT INTO event (name, headliner_artist_id) VALUES ('Legacy', 3)");
		await query("DELETE FROM artist WHERE id=3");
		assert.equal((await query("SELECT headliner_artist_id FROM event"))[0].headliner_artist_id, null);
	});
});
