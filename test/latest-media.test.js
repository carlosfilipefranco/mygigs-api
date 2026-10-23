const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../services/db");
const router = require("../routes/gig");

const originalQuery = db.query;
let server, origin, queries;

before(async () => {
	const app = express();
	app.use("/gig", router);
	app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
	queries = [];
	db.query = async (sql, params) => {
		queries.push({ sql, params });
		return [{ id: params[0] === "image" ? 20 : 19, gig_id: 10, artist: "Test artist", user_id: 1 }];
	};
});

after(async () => {
	db.query = originalQuery;
	await new Promise((resolve) => server.close(resolve));
});

test("latest photos and reviews are public and default to music", async () => {
	const response = await fetch(`${origin}/gig/media/latest`);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.photos[0].id, 20);
	assert.equal(result.reviews[0].id, 19);
	assert.deepEqual(queries.map((query) => query.params), [["image", 1], ["link", 1]]);
});

test("theatre uses the concert type and orders by media addition", async () => {
	assert.equal((await fetch(`${origin}/gig/media/latest?type=2`)).status, 200);
	for (const query of queries) {
		assert.equal(query.params[1], 2);
		assert.match(query.sql, /g.type = \?/);
		assert.match(query.sql, /ORDER BY gm.id DESC/);
	}
});

test("invalid types are rejected before accessing the database", async () => {
	for (const type of ["0", "3", "invalid", "1%20OR%201=1"]) {
		assert.equal((await fetch(`${origin}/gig/media/latest?type=${type}`)).status, 400);
	}
	assert.equal(queries.length, 0);
});

test("empty feeds return empty lists", async () => {
	db.query = async () => [];
	const response = await fetch(`${origin}/gig/media/latest`);
	assert.deepEqual(await response.json(), { photos: [], reviews: [] });
});
