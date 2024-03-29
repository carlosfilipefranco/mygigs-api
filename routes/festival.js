const express = require("express");
const router = express.Router();
const festival = require("../services/festival");

/* GET festival. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await festival.getMultiple(req.query.page, req.query.search));
	} catch (err) {
		console.error(`Error while getting gig `, err.message);
		next(err);
	}
});

/* POST festival */
router.post("/", async function (req, res, next) {
	try {
		res.json(await festival.create(req.body));
	} catch (err) {
		console.error(`Error while creating festival`, err.message);
		next(err);
	}
});

/* PUT festival */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await festival.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating festival`, err.message);
		next(err);
	}
});

/* GET festival */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await festival.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

/* GET edition */
router.get("/edition/:id", async function (req, res, next) {
	try {
		res.json(await festival.getEdition(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

/* DELETE festival */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await festival.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting festival`, err.message);
		next(err);
	}
});

module.exports = router;
