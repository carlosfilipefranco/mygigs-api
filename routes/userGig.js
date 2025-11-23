const express = require("express");
const router = express.Router();
const userGig = require("../services/userGig");
const { requireAuth } = require("../middleware/auth");
const db = require("../services/db");

/* POST /user-gig/status */
router.post("/status", requireAuth, async (req, res, next) => {
	try {
		const { gigId, status } = req.body;
		await userGig.setStatus(req.user.id, gigId, status);
		res.json({ success: true });
	} catch (err) {
		next(err);
	}
});

/* POST /user-gig/favorite */
router.post("/favorite", requireAuth, async (req, res, next) => {
	try {
		const { gigId, favorite } = req.body;
		await userGig.toggleFavorite(req.user.id, gigId, favorite);
		res.json({ success: true });
	} catch (err) {
		next(err);
	}
});

/* POST /user-gig/ticket */
router.post("/ticket", requireAuth, async (req, res, next) => {
	try {
		const { gigId, hasTicket } = req.body;
		await userGig.toggleTicket(req.user.id, gigId, hasTicket);
		res.json({ success: true });
	} catch (err) {
		next(err);
	}
});

/* GET /user-gig */
router.get("/", requireAuth, async (req, res, next) => {
	try {
		const gigs = await userGig.getUserGigs(req.user.id);
		res.json(gigs);
	} catch (err) {
		next(err);
	}
});

// GET total de user_gig
router.get("/count", async (req, res, next) => {
	try {
		const rows = await db.query("SELECT COUNT(*) AS total FROM user_gig");
		const total = rows[0]?.total || 0;
		res.json({ total });
	} catch (err) {
		next(err);
	}
});

module.exports = router;
