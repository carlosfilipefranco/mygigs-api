const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../services/db");
const preview = require("../services/reviewPreview");
const router = require("../routes/gig");
const auth = require("../services/auth");

const originalQuery = db.query;
const originalPreview = preview.getPreview;
let server, origin, rows, requested;

before(async () => {
	const app = express();
	app.use(express.json());
	app.use("/gig", router);
	app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
	rows = [];
	requested = [];
	db.query = async (sql, params) => { requested.push({ sql, params }); return rows; };
	preview.getPreview = async (url) => ({ url, title: "Review de teste", available: true });
});

after(async () => {
	db.query = originalQuery;
	preview.getPreview = originalPreview;
	await new Promise((resolve) => server.close(resolve));
});

test("public visitors can preview an existing review of the specified concert", async () => {
	rows = [{ url: "https://example.com/review" }];
	const response = await fetch(`${origin}/gig/10/reviews/7/preview`);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).title, "Review de teste");
	assert.deepEqual(requested[0].params, ["10", "7"]);
	assert.match(requested[0].sql, /gig_id = \? AND id = \? AND type = 'link'/);
});

test("does not preview an arbitrary URL, a photo or a review of another concert", async () => {
	preview.getPreview = async () => assert.fail("Missing media must not trigger an external request");
	const response = await fetch(`${origin}/gig/99/reviews/7/preview?url=https://example.com`);
	assert.equal(response.status, 404);
});

test("rejects invalid review links without accessing the database", async () => {
	const response = await fetch(`${origin}/gig/10/media`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.generateToken({ id: 1, role: "admin" })}` },
		body: JSON.stringify({ type: "link", url: "http://127.0.0.1/secret" })
	});
	assert.equal(response.status, 400);
	assert.equal(requested.length, 0);
});
