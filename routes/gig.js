const express = require("express");
const router = express.Router();
const gig = require("../services/gig");
const authMiddleware = require("../middleware/auth");

/* GET gig. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await gig.getMultiple(req.query.page, req.query.search, req.query.favorite, req.query.type));
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
		res.json(await gig.dashboard(req.query.type));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* PUT gig */
router.get("/:id", authMiddleware, async (req, res, next) => {
	try {
		// Se estiver logado, req.user.id existe
		const userId = req.user ? req.user.id : null;
		const gigData = await gig.get(req.params.id, userId);
		res.json(gigData);
	} catch (err) {
		console.error("Error fetching gig", err.message);
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

router.post("/:id/media", async (req, res, next) => {
	try {
		res.json(await gig.addMedia(req.params.id, req.body));
	} catch (err) {
		console.error("Error while adding media", err.message);
		next(err);
	}
});

router.put("/:id/media/:mediaId", async (req, res, next) => {
	try {
		res.json(await gig.updateMedia(req.params.id, req.params.mediaId, req.body));
	} catch (err) {
		console.error("Error while updating media", err.message);
		next(err);
	}
});

router.delete("/:id/media/:mediaId", async (req, res, next) => {
	try {
		res.json(await gig.deleteMedia(req.params.id, req.params.mediaId));
	} catch (err) {
		console.error("Error while deleting media", err.message);
		next(err);
	}
});

module.exports = router;
