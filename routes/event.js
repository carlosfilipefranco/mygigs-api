const express = require("express");
const router = express.Router();
const gig = require("../services/event");

/* GET events. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await gig.getMultiple(req.query.page, req.query.search));
	} catch (err) {
		console.error(`Error while getting gig `, err.message);
		next(err);
	}
});

/* GET event */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await gig.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

module.exports = router;
