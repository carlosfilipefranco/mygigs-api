const { describe, test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const db = require("../services/db");
const gig = require("../services/gig");

// O teste só usa uma instância explicitamente indicada, nunca a BD da app.
describe("latest media MySQL queries", { skip: !process.env.MYSQL_TEST_SOCKET }, () => {
	const database = `mygigs_latest_media_${process.pid}_${Date.now()}`;
	const originalQuery = db.query;
	let connection;

	before(async () => {
		connection = await mysql.createConnection({
			socketPath: process.env.MYSQL_TEST_SOCKET,
			user: process.env.MYSQL_TEST_USER || "root",
			password: process.env.MYSQL_TEST_PASSWORD || "",
			multipleStatements: true
		});
		await connection.query(`CREATE DATABASE \`${database}\``);
		await connection.query(`USE \`${database}\``);
		await connection.query(`
			CREATE TABLE user (id INT PRIMARY KEY, name VARCHAR(255));
			CREATE TABLE artist (id INT PRIMARY KEY, name VARCHAR(255), type INT);
			CREATE TABLE venue (id INT PRIMARY KEY, name VARCHAR(255));
			CREATE TABLE gig (id INT PRIMARY KEY, date DATE, artist_id INT, venue_id INT, type INT);
			CREATE TABLE gig_media (id INT AUTO_INCREMENT PRIMARY KEY, gig_id INT, user_id INT NULL, url TEXT, type VARCHAR(10));
			INSERT INTO user VALUES (1, 'First author'), (2, 'Second author');
			INSERT INTO artist VALUES (1, 'Music artist', 2), (2, 'Theatre artist', 1);
			INSERT INTO venue VALUES (1, 'Test venue');
			INSERT INTO gig VALUES (10, '2030-01-01', 1, 1, 1), (11, '2000-01-01', 1, 1, 1), (20, '2026-01-01', 2, 1, 2);
		`);
		db.query = async (sql, params) => (await connection.execute(sql, params))[0];
	});

	beforeEach(async () => {
		await connection.query(`
			TRUNCATE TABLE gig_media;
			INSERT INTO gig_media (gig_id, user_id, url, type) VALUES
				(10, 1, 'https://example.com/old-photo.jpg', 'image'),
				(11, 2, 'https://example.com/recent-photo.jpg', 'image'),
				(11, 2, 'https://example.com/review', 'link'),
				(20, 1, 'https://example.com/theatre-review', 'link'),
				(20, 1, 'https://example.com/theatre-photo.jpg', 'image'),
				(10, 1, 'https://example.com/video', 'video'),
				(11, NULL, 'https://example.com/deleted-author.jpg', 'image');
		`);
	});

	after(async () => {
		db.query = originalQuery;
		if (connection) {
			try {
				await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
			} finally {
				await connection.end();
			}
		}
	});

	test("orders by addition, includes different and deleted authors, and excludes videos", async () => {
		const result = await gig.getLatestMedia("1");
		assert.deepEqual(result.photos.map((photo) => photo.id), [7, 2, 1]);
		assert.deepEqual(result.photos.map((photo) => photo.user_name), [null, "Second author", "First author"]);
		assert.equal(result.photos[1].gig_id, 11);
		assert.deepEqual(result.reviews.map((review) => review.id), [3]);
	});

	test("filters by concert type even when the artist has a different type", async () => {
		const result = await gig.getLatestMedia("2");
		assert.deepEqual(result.photos.map((photo) => photo.id), [5]);
		assert.deepEqual(result.reviews.map((review) => review.id), [4]);
	});

	test("limits the home feed to eight photos and four reviews", async () => {
		for (let index = 0; index < 10; index++) {
			await connection.execute("INSERT INTO gig_media (gig_id, user_id, url, type) VALUES (11, 1, ?, 'image'), (11, 1, ?, 'link')", [`https://example.com/${index}.jpg`, `https://example.com/review-${index}`]);
		}
		const result = await gig.getLatestMedia("1");
		assert.equal(result.photos.length, 8);
		assert.equal(result.reviews.length, 4);
		assert.equal(result.photos[0].id, 26);
		assert.equal(result.reviews[0].id, 27);
	});
});
