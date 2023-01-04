const express = require("express");
const router = express.Router();
const city = require("../services/city");

/* GET city. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await city.getMultiple(req.query.page));
	} catch (err) {
		console.error(`Error while getting city `, err.message);
		next(err);
	}
});

/* POST city */
router.post("/", async function (req, res, next) {
	try {
		res.json(await city.create(req.body));
	} catch (err) {
		console.error(`Error while creating city`, err.message);
		next(err);
	}
});

/* PUT city */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await city.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating city`, err.message);
		next(err);
	}
});

/* GET city */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await city.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating city`, err.message);
		next(err);
	}
});

/* DELETE city */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await city.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting city`, err.message);
		next(err);
	}
});

module.exports = router;
