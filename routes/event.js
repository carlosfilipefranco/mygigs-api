const express = require("express");
const router = express.Router();
const event = require("../services/event");

/* GET events. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await event.getMultiple(req.query.page, req.query.search, req.query.type));
	} catch (err) {
		console.error(`Error while getting event `, err.message);
		next(err);
	}
});

/* GET event */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await event.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating event`, err.message);
		next(err);
	}
});

/* POST event */
router.post("/", async function (req, res, next) {
	try {
		res.json(await event.create(req.body));
	} catch (err) {
		console.error(`Error while creating event`, err.message);
		next(err);
	}
});

/* DELETE event */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await event.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting event`, err.message);
		next(err);
	}
});

/* PUT artist */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await event.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating event`, err.message);
		next(err);
	}
});

module.exports = router;
