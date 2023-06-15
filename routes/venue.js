const express = require("express");
const router = express.Router();
const venue = require("../services/venue");

/* GET venues. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await venue.getMultiple(req.query.page, req.query.search));
	} catch (err) {
		console.error(`Error while getting venues `, err.message);
		next(err);
	}
});

/* POST venue */
router.post("/", async function (req, res, next) {
	try {
		res.json(await venue.create(req.body));
	} catch (err) {
		console.error(`Error while creating venue`, err.message);
		next(err);
	}
});

/* PUT venue */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await venue.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating venue`, err.message);
		next(err);
	}
});

/* GET venue */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await venue.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating city`, err.message);
		next(err);
	}
});

/* DELETE venue */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await venue.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting venue`, err.message);
		next(err);
	}
});

module.exports = router;
