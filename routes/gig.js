const express = require("express");
const router = express.Router();
const gig = require("../services/gig");

/* GET gig. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await gig.getMultiple(req.query.page, req.query.search, req.query.favorite));
	} catch (err) {
		console.error(`Error while getting gig `, err.message);
		next(err);
	}
});

/* POST gig */
router.post("/", async function (req, res, next) {
	try {
		res.json(await gig.create(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* POST gig */
router.post("/clean", async function (req, res, next) {
	try {
		res.json(await gig.clean(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* GET dashboard */
router.get("/dashboard", async function (req, res, next) {
	try {
		res.json(await gig.dashboard(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* PUT gig */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await gig.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

/* GET city */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await gig.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

/* DELETE gig */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await gig.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting gig`, err.message);
		next(err);
	}
});

/* SORT gigs */
router.post("/sort", async function (req, res, next) {
	try {
		res.json(await gig.sort(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* FAVORITE gigs */
router.post("/favorite", async function (req, res, next) {
	try {
		res.json(await gig.favorite(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

module.exports = router;
