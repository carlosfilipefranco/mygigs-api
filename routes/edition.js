const express = require("express");
const router = express.Router();
const edition = require("../services/edition");
const { requireAdmin, optionalAuth } = require("../middleware/auth");

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
router.post("/", requireAdmin, async function (req, res, next) {
	try {
		res.json(await edition.create(req.body));
	} catch (err) {
		console.error(`Error while creating edition`, err.message);
		next(err);
	}
});

/* PUT edition */
router.put("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await edition.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating edition`, err.message);
		next(err);
	}
});

/* POST edition program import */
router.post("/:id/import-program", requireAdmin, async function (req, res, next) {
	try {
		res.json(await edition.importProgram(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while importing edition program`, err.message);
		next(err);
	}
});

/* GET edition */
router.get("/:id", optionalAuth, async function (req, res, next) {
	try {
		res.json(await edition.get(req.params.id, req.user?.id));
	} catch (err) {
		console.error(`Error while updating city`, err.message);
		next(err);
	}
});

/* DELETE edition */
router.delete("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await edition.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting edition`, err.message);
		next(err);
	}
});

module.exports = router;
