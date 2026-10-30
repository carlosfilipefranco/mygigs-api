const express = require("express");
const router = express.Router();
const gig = require("../services/gig");
const comments = require("../services/gigComments");
const { optionalAuth, requireAuth, requireAdmin } = require("../middleware/auth");

/* GET gigs (lista) */
router.get("/", optionalAuth, async function (req, res, next) {
	try {
		const userId = req.user ? req.user.id : null;
		res.json(await gig.getMultiple(userId, req.query.page, req.query.search, req.query.favorite, req.query.type, req.query.period, req.query.mine, req.query.order, req.query));
	} catch (err) {
		console.error(`Error while getting gig `, err.message);
		next(err);
	}
});

/* POST gig */
router.post("/", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.create(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* POST gig */
router.post("/clean", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.clean(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* GET dashboard */
router.get("/dashboard", optionalAuth, async function (req, res, next) {
	try {
		const userId = req.user ? req.user.id : null;
		res.json(await gig.dashboard(req.query.type, userId, req.query.period, req.query.scope, req.query));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

router.get("/media/latest", async (req, res, next) => {
	try {
		res.json(await gig.getLatestMedia(req.query.type, req.query));
	} catch (err) {
		next(err);
	}
});

router.get("/photos/mine", requireAuth, async (req, res, next) => {
	try {
		res.json(await gig.getMyPhotos(req.user.id, req.query.page));
	} catch (err) {
		next(err);
	}
});

router.get("/:id/comments", optionalAuth, async (req, res, next) => {
	try {
		res.set("Cache-Control", "no-store");
		res.json(await comments.list(req.params.id, req.query.before));
	} catch (error) { next(error); }
});

router.post("/:id/comments", requireAuth, async (req, res, next) => {
	try {
		res.status(201).json(await comments.create(req.params.id, req.body, req.user.id));
	} catch (error) { next(error); }
});

router.delete("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
	try {
		res.json(await comments.remove(req.params.id, req.params.commentId, req.user));
	} catch (error) { next(error); }
});

/* GET gig */
router.get("/:id", optionalAuth, async (req, res, next) => {
	try {
		const userId = req.user ? req.user.id : null;
		const gigData = await gig.get(req.params.id, userId);
		res.json(gigData);
	} catch (err) {
		console.error("Error fetching gig", err.message);
		next(err);
	}
});

/* PUT gig */
router.put("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating gig`, err.message);
		next(err);
	}
});

/* DELETE gig */
router.delete("/:id", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.remove(req.params.id, req.body || {}));
	} catch (err) {
		console.error(`Error while deleting gig`, err.message);
		next(err);
	}
});

/* SORT gigs */
router.post("/sort", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.sort(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

/* FAVORITE gigs */
router.post("/favorite", requireAdmin, async function (req, res, next) {
	try {
		res.json(await gig.favorite(req.body));
	} catch (err) {
		console.error(`Error while creating gig`, err.message);
		next(err);
	}
});

router.get("/:id/reviews/:reviewId/preview", async (req, res, next) => {
	try {
		res.json(await gig.getReviewPreview(req.params.id, req.params.reviewId));
	} catch (err) {
		next(err);
	}
});

router.post("/:id/media", requireAuth, async (req, res, next) => {
	try {
		if (req.body.type !== "image" && req.user.role !== "admin") {
			return res.status(403).json({ message: "Admin access required" });
		}
		res.json(await gig.addMedia(req.params.id, req.body, req.user.id));
	} catch (err) {
		console.error("Error while adding media", err.message);
		next(err);
	}
});

router.put("/:id/media/:mediaId", requireAdmin, async (req, res, next) => {
	try {
		res.json(await gig.updateMedia(req.params.id, req.params.mediaId, req.body, req.user.id));
	} catch (err) {
		console.error("Error while updating media", err.message);
		next(err);
	}
});

router.delete("/:id/media/:mediaId", requireAuth, async (req, res, next) => {
	try {
		res.json(await gig.deleteMedia(req.params.id, req.params.mediaId, req.user));
	} catch (err) {
		console.error("Error while deleting media", err.message);
		next(err);
	}
});

module.exports = router;
