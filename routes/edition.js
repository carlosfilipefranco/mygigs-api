const express = require("express");
const router = express.Router();
const edition = require("../services/edition");

/* GET editions. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await edition.getMultiple(req.query.page, req.query.search));
	} catch (err) {
		console.error(`Error while getting editions `, err.message);
		next(err);
	}
});

/* POST edition */
router.post("/", async function (req, res, next) {
	try {
		res.json(await edition.create(req.body));
	} catch (err) {
		console.error(`Error while creating edition`, err.message);
		next(err);
	}
});

/* PUT edition */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await edition.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating edition`, err.message);
		next(err);
	}
});

/* GET edition */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await edition.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating city`, err.message);
		next(err);
	}
});

/* DELETE edition */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await edition.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting edition`, err.message);
		next(err);
	}
});

module.exports = router;
