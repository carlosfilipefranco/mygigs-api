const express = require("express");
const router = express.Router();
const adminTools = require("../services/adminTools");
const setlistFmImport = require("../services/setlistFmImport");
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

router.post("/setlistfm-preview", requireAdmin, async function (req, res, next) {
	try {
		res.json(await setlistFmImport.preview(req.body || {}));
	} catch (err) {
		console.error(`Error while previewing setlist.fm import`, err.message);
		next(err);
	}
});

router.post("/setlistfm-import", requireAdmin, async function (req, res, next) {
	try {
		res.json(await setlistFmImport.importEntries(req.body || {}));
	} catch (err) {
		console.error(`Error while importing setlist.fm data`, err.message);
		next(err);
	}
});

module.exports = router;
