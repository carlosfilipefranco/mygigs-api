const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const auth = require("../services/auth");
const { optionalAuth, requireAuth, requireAdmin } = require("../middleware/auth");
const users = require("../services/user");
const userRouter = require("../routes/user");
const originalGet = users.get;
const user = { id: 7, email: "session@example.com", name: "Session test", role: "user", image: null };
const secret = "SUA_CHAVE_SECRETA_AQUI";
let server, origin, currentUser, requested;
const headers = (token = auth.generateToken(user)) => ({ Authorization: `Bearer ${token}` });

before(async () => {
	const app = express();
	app.use(express.json());
	app.get("/public", optionalAuth, (req, res) => res.json({ id: req.user?.id || null }));
	app.get("/private", requireAuth, (req, res) => res.json({ id: req.user.id }));
	app.get("/admin", requireAdmin, (req, res) => res.json({ id: req.user.id }));
	app.use("/user", userRouter);
	app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
	server = app.listen(0, "127.0.0.1");
	await new Promise(resolve => server.once("listening", resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
	users.get = async (id) => { requested.push(id); return currentUser; };
});
beforeEach(() => { currentUser = { ...user }; requested = []; });
after(async () => { users.get = originalGet; await new Promise(resolve => server.close(resolve)); });

test("new session tokens have no expiry and remain valid years after issue", () => {
	const token = auth.generateToken(user);
	assert.equal(jwt.decode(token).exp, undefined);
	const now = Date.now;
	try {
		Date.now = () => now() + 10 * 365 * 86400000;
		assert.equal(auth.verifyToken(token).id, user.id);
	} finally { Date.now = now; }
});
test("still rejects expired legacy tokens and tampered signatures", () => {
	assert.equal(auth.verifyToken(jwt.sign({ id: 7 }, secret, { expiresIn: -1 })), null);
	assert.equal(auth.verifyToken(jwt.sign({ id: 7 }, "wrong-secret")), null);
});
test("public requests without credentials remain anonymous", async () => {
	const r = await fetch(`${origin}/public`);
	assert.equal(r.status, 200); assert.deepEqual(await r.json(), { id: null });
});
test("public requests with valid credentials retain user context", async () => {
	const r = await fetch(`${origin}/public`, { headers: headers() });
	assert.equal(r.status, 200); assert.deepEqual(await r.json(), { id: 7 });
});
test("public routes return 401 for expired, malformed or invalid credentials", async () => {
	for (const authorization of ["Bearer invalid", "Bearer", "Basic invalid", `Bearer ${jwt.sign({ id: 7 }, secret, { expiresIn: -1 })}`]) {
		assert.equal((await fetch(`${origin}/public`, { headers: { Authorization: authorization } })).status, 401);
	}
});
test("protected routes require valid bearer credentials", async () => {
	assert.equal((await fetch(`${origin}/private`)).status, 401);
	assert.equal((await fetch(`${origin}/private`, { headers: headers("invalid") })).status, 401);
	assert.equal((await fetch(`${origin}/private`, { headers: headers() })).status, 200);
});
test("insufficient permissions return 403 while admins retain access", async () => {
	assert.equal((await fetch(`${origin}/admin`, { headers: headers() })).status, 403);
	assert.equal((await fetch(`${origin}/admin`, { headers: headers(auth.generateToken({ ...user, role: "admin" })) })).status, 200);
});
test("session endpoint renews a still-valid legacy token and returns the current profile", async () => {
	currentUser = { ...user, name: "Updated name", role: "admin" };
	const legacy = jwt.sign({ id: 7, email: user.email, role: "user" }, secret, { expiresIn: "7d" });
	const r = await fetch(`${origin}/user/session`, { method: "POST", headers: headers(legacy) });
	assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
	const data = await r.json();
	assert.equal(data.name, "Updated name"); assert.equal(data.role, "admin");
	assert.equal(jwt.decode(data.token).exp, undefined); assert.equal(auth.verifyToken(data.token).role, "admin");
	assert.deepEqual(requested, [7]);
});
test("session endpoint rejects deleted accounts", async () => {
	currentUser = null;
	const r = await fetch(`${origin}/user/session`, { method: "POST", headers: headers() });
	assert.equal(r.status, 401); assert.equal((await r.json()).token, undefined);
});
test("session endpoint never renews an expired or missing token", async () => {
	const expired = jwt.sign({ id: 7 }, secret, { expiresIn: -1 });
	assert.equal((await fetch(`${origin}/user/session`, { method: "POST", headers: headers(expired) })).status, 401);
	assert.equal((await fetch(`${origin}/user/session`, { method: "POST" })).status, 401);
	assert.deepEqual(requested, []);
});
test("database unavailability during validation is a server error rather than a logout", async () => {
	const get = users.get;
	users.get = async () => { throw new Error("Database unavailable"); };
	try { assert.equal((await fetch(`${origin}/user/session`, { method: "POST", headers: headers() })).status, 500); }
	finally { users.get = get; }
});
