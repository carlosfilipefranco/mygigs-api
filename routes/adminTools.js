const express = require("express");
const router = express.Router();
const adminTools = require("../services/adminTools");
const { requireAdmin } = require("../middleware/auth");

router.get("/artist-duplicates", requireAdmin, async function (req, res, next) {
	try {
		res.json(await adminTools.getArtistDuplicates(req.query.type, req.query.limit));
	} catch (err) {
		console.error(`Error while getting artist duplicates`, err.message);
		next(err);
	}
});

router.get("/gig-duplicates", requireAdmin, async function (req, res, next) {
	try {
		res.json(await adminTools.getGigDuplicates(req.query.type, req.query.limit));
	} catch (err) {
		console.error(`Error while getting gig duplicates`, err.message);
		next(err);
	}
});

module.exports = router;
