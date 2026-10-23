const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../services/db");
const auth = require("../services/auth");
const gig = require("../services/gig");
const router = require("../routes/gig");

const originalQuery = db.query;
const queries = [];
let server;
let origin;
let photoRows = [];

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
	queries.length = 0;
	photoRows = [];
	db.query = async (sql, params) => {
		queries.push({ sql, params });
		if (sql.includes("FROM gig WHERE")) return [{ id: 10 }];
		if (sql.includes("FROM gig_media gm")) return photoRows;
		return { affectedRows: 1 };
	};
});

after(async () => {
	db.query = originalQuery;
	if (server) await new Promise((resolve) => server.close(resolve));
});

function request(path, { user, body, token } = {}) {
	const headers = { "Content-Type": "application/json" };
	if (user || token) headers.Authorization = `Bearer ${token || auth.generateToken(user)}`;
	return fetch(`${origin}/gig${path}`, {
		method: body ? "POST" : "GET",
		headers,
		...(body ? { body: JSON.stringify(body) } : {})
	});
}

test("anonymous visitors cannot add photos or access personal photos", async () => {
	assert.equal((await request("/10/media", { body: { type: "image", url: "https://example.com/photo.jpg" } })).status, 401);
	assert.equal((await request("/photos/mine")).status, 401);
	assert.equal(queries.length, 0);
});

test("invalid tokens cannot add photos", async () => {
	const jwt = require("jsonwebtoken");
	const valid = auth.generateToken({ id: 7, role: "user" });
	const payload = jwt.decode(valid);
	// Reuse a valid signature with an altered payload: verification must fail.
	const parts = valid.split(".");
	parts[1] = Buffer.from(JSON.stringify({ ...payload, exp: 1 })).toString("base64url");
	assert.equal((await request("/10/media", { token: parts.join("."), body: { type: "image", url: "https://example.com/photo.jpg" } })).status, 401);
	assert.equal(queries.length, 0);
});

test("expired sessions cannot add photos or access personal photos", async () => {
	// Os tokens novos são persistentes; confirmar que os antigos continuam a expirar.
	const token = require("jsonwebtoken").sign({ id: 7, role: "user" }, "SUA_CHAVE_SECRETA_AQUI", { expiresIn: "7d" });
	const now = Date.now;
	try {
		Date.now = () => now() + 8 * 24 * 60 * 60 * 1000;
		assert.equal((await request("/10/media", { token, body: { type: "image", url: "https://example.com/photo.jpg" } })).status, 401);
		assert.equal((await request("/photos/mine", { token })).status, 401);
		assert.equal(queries.length, 0);
	} finally {
		Date.now = now;
	}
});

test("regular users can add photos and cannot spoof another author", async () => {
	const response = await request("/10/media", {
		user: { id: 7, role: "user" },
		body: { type: "image", url: " https://example.com/photo.jpg ", user_id: 1 }
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { success: true });
	assert.deepEqual(queries.find((query) => query.sql.startsWith("INSERT")).params, ["10", "https://example.com/photo.jpg", "image", 7]);
});

test("regular users cannot add videos or links", async () => {
	for (const type of ["video", "link"]) {
		const response = await request("/10/media", { user: { id: 7, role: "user" }, body: { type, url: "https://example.com/review" } });
		assert.equal(response.status, 403);
	}
	assert.equal(queries.length, 0);
});

test("admins retain access to adding other media", async () => {
	assert.equal((await request("/10/media", { user: { id: 1, role: "admin" }, body: { type: "link", url: "https://example.com/review" } })).status, 200);
});

test("invalid photo URLs are rejected before accessing the database", async () => {
	for (const url of ["", "javascript:alert(1)", "https://example.com/a b", 42]) {
		assert.equal((await request("/10/media", { user: { id: 7 }, body: { type: "image", url } })).status, 400);
	}
	assert.equal(queries.length, 0);
});

test("photos cannot be attached to a missing concert", async () => {
	db.query = async () => [];
	assert.equal((await request("/999/media", { user: { id: 7 }, body: { type: "image", url: "https://example.com/photo.jpg" } })).status, 404);
});

test("personal photo requests always filter by the authenticated user", async () => {
	photoRows = [{ id: 11, user_id: 7, url: "https://example.com/photo.jpg", artist: "Test artist" }];
	const response = await request("/photos/mine?user_id=1", { user: { id: 7 } });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { data: photoRows, hasMore: false, page: 1 });
	assert.deepEqual(queries[0].params, [7]);
	assert.match(queries[0].sql, /gm.type = 'image' AND gm.user_id = \?/);
});

test("personal photos are paginated in newest-first order", async () => {
	photoRows = Array.from({ length: 25 }, (_, index) => ({ id: 100 - index }));
	const result = await gig.getMyPhotos(7, 2);
	assert.equal(result.data.length, 24);
	assert.equal(result.hasMore, true);
	assert.equal(result.page, 2);
	assert.match(queries[0].sql, /ORDER BY gm.id DESC LIMIT 25 OFFSET 24/);
});

test("invalid page values fall back to the first page", async () => {
	for (const page of ["invalid", "-5", "0", "1; DROP TABLE gig_media"]) {
		const result = await gig.getMyPhotos(7, page);
		assert.equal(result.page, 1);
	}
});

test("editing media preserves its author and attributes authorless media to the admin", async () => {
	await gig.updateMedia(10, 11, { type: "image", url: "https://example.com/new.jpg" }, 1);
	assert.match(queries[0].sql, /user_id=COALESCE\(user_id, \?\)/);
	assert.deepEqual(queries[0].params, ["https://example.com/new.jpg", "image", 1, 11, 10]);
});
