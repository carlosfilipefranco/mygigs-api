const express = require("express");
const router = express.Router();
const submission = require("../services/submission");
const { requireAuth, requireAdmin } = require("../middleware/auth");

/* POST user suggestion */
router.post("/", requireAuth, async function (req, res, next) {
	try {
		res.json(await submission.create(req.user.id, req.body));
	} catch (err) {
		console.error("Error while creating suggestion", err.message);
		next(err);
	}
});

/* GET own suggestions */
router.get("/mine", requireAuth, async function (req, res, next) {
	try {
		res.json(await submission.getMine(req.user.id, req.query.status, req.query.limit));
	} catch (err) {
		console.error("Error while getting own suggestions", err.message);
		next(err);
	}
});

/* GET suggestions for admin review */
router.get("/", requireAdmin, async function (req, res, next) {
	try {
		res.json(await submission.getMultiple(req.query.status, req.query.limit));
	} catch (err) {
		console.error("Error while getting suggestions", err.message);
		next(err);
	}
});

/* POST approve suggestion */
router.post("/:id/approve", requireAdmin, async function (req, res, next) {
	try {
		res.json(await submission.approve(req.params.id, req.user.id, req.body));
	} catch (err) {
		console.error("Error while approving suggestion", err.message);
		next(err);
	}
});

/* POST reject suggestion */
router.post("/:id/reject", requireAdmin, async function (req, res, next) {
	try {
		res.json(await submission.reject(req.params.id, req.user.id, req.body));
	} catch (err) {
		console.error("Error while rejecting suggestion", err.message);
		next(err);
	}
});

module.exports = router;
