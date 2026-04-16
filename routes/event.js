const express = require("express");
const router = express.Router();
const event = require("../services/event");
const eventImport = require("../services/eventImport");
const { optionalAuth, requireAdmin } = require("../middleware/auth");

/* GET events. */
router.get("/", optionalAuth, async function (req, res, next) {
	try {
		res.json(await event.getMultiple(req.query.page, req.query.search, req.query.type, req.query.period, req.user?.id));
	} catch (err) {
		console.error(`Error while getting event `, err.message);
		next(err);
	}
});

/* GET dashboard */
router.get("/dashboard", async function (req, res, next) {
	try {
		res.json(await event.dashboard(req.query.type));
	} catch (err) {
		console.error(`Error while getting event dashboard`, err.message);
		next(err);
	}
});

/* POST event import preview */
router.post("/preview-url", requireAdmin, async function (req, res, next) {
	try {
		res.json(await eventImport.previewFromUrl(req.body.url));
	} catch (err) {
		console.error(`Error while previewing event url`, err.message);
		next(err);
	}
});

/* GET event */
router.get("/:id", optionalAuth, async function (req, res, next) {
	try {
		res.json(await event.get(req.params.id, req.user?.id));
	} catch (err) {
		console.error(`Error while updating event`, err.message);
		next(err);
	}
});

/* POST event */
router.post("/", requireAdmin, async function (req, res, next) {
	try {
		res.json(await event.create(req.body));
	} catch (err) {
		console.error(`Error while creating event`, err.message);
		next(err);
	}
});

/* DELETE event */
router.delete("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await event.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting event`, err.message);
		next(err);
	}
});

/* PUT artist */
router.put("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await event.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating event`, err.message);
		next(err);
	}
});

module.exports = router;
