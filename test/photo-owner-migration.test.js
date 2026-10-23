const { describe, test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

// Usar apenas uma instância de teste indicada explicitamente, nunca a config da app.
const socketPath = process.env.MYSQL_TEST_SOCKET;
const migration = fs.readFileSync(path.join(__dirname, "../migrations/20261023_add_photo_owners.sql"), "utf8");

describe("photo ownership migration", { skip: !socketPath }, () => {
	const database = `mygigs_photo_test_${process.pid}_${Date.now()}`;
	let connection;

	before(async () => {
		connection = await mysql.createConnection({
			socketPath,
			user: process.env.MYSQL_TEST_USER || "root",
			password: process.env.MYSQL_TEST_PASSWORD || "",
			multipleStatements: true
		});
		await connection.query(`CREATE DATABASE \`${database}\``);
		await connection.query(`USE \`${database}\``);
	});

	beforeEach(async () => {
		await connection.query("DROP TABLE IF EXISTS gig_media; DROP TABLE IF EXISTS user");
		await connection.query(`
			CREATE TABLE user (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
			INSERT INTO user (id) VALUES (1), (2), (3);
			CREATE TABLE gig_media (
				id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
				gig_id INT NOT NULL,
				url TEXT NOT NULL,
				type ENUM('image', 'video', 'link') NOT NULL DEFAULT 'image'
			) ENGINE=InnoDB;
			INSERT INTO gig_media (gig_id, url, type) VALUES
				(10, 'https://example.com/photo.jpg', 'image'),
				(10, 'https://example.com/video', 'video'),
				(10, 'https://example.com/review', 'link');
		`);
	});

	after(async () => {
		if (connection) {
			try {
				await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
			} finally {
				await connection.end();
			}
		}
	});

	test("creates the schema and assigns only legacy photos to user 1", async () => {
		await connection.query(migration);
		const [rows] = await connection.query("SELECT type, user_id FROM gig_media ORDER BY id");
		assert.deepEqual(rows, [
			{ type: "image", user_id: 1 },
			{ type: "video", user_id: null },
			{ type: "link", user_id: null }
		]);
		const [indexes] = await connection.query("SHOW INDEX FROM gig_media WHERE Key_name = 'gig_media_user_type_id_idx'");
		assert.deepEqual(indexes.map((row) => row.Column_name), ["user_id", "type", "id"]);
	});

	test("can run twice without duplicate columns, indexes or constraints", async () => {
		await connection.query(migration);
		await connection.query(migration);
		const [rows] = await connection.query("SELECT user_id FROM gig_media WHERE type = 'image'");
		assert.equal(rows[0].user_id, 1);
	});

	test("repeating preserves other authors and null owners from deleted accounts", async () => {
		await connection.query(migration);
		await connection.query(`
			INSERT INTO gig_media (gig_id, url, type, user_id) VALUES
				(10, 'https://example.com/deleted.jpg', 'image', 2),
				(10, 'https://example.com/other.jpg', 'image', 3);
			DELETE FROM user WHERE id = 2;
		`);
		await connection.query(migration);
		const [rows] = await connection.query("SELECT user_id FROM gig_media WHERE type = 'image' ORDER BY id");
		assert.deepEqual(rows.map((row) => row.user_id), [1, null, 3]);
	});

	test("adds missing index and constraint when the column already exists", async () => {
		await connection.query("ALTER TABLE gig_media ADD COLUMN user_id INT NULL AFTER gig_id");
		await connection.query("UPDATE gig_media SET user_id = 3 WHERE type = 'image'");
		await connection.query(migration);
		await connection.query("DELETE FROM user WHERE id = 3");
		const [rows] = await connection.query("SELECT user_id FROM gig_media WHERE type = 'image'");
		assert.equal(rows[0].user_id, null);
		const [indexes] = await connection.query("SHOW INDEX FROM gig_media WHERE Key_name = 'gig_media_user_type_id_idx'");
		assert.equal(indexes.length, 3);
	});
});
