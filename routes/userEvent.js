const express = require("express");
const router = express.Router();
const userEvent = require("../services/userEvent");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

router.get("/", async function (req, res, next) {
	try {
		res.json(
			await userEvent.getUserEvents(req.user.id, req.query.page, {
				period: req.query.period,
				status: req.query.status,
				type: req.query.type
			})
		);
	} catch (err) {
		console.error(`Error while getting user events`, err.message);
		next(err);
	}
});

router.post("/status", async function (req, res, next) {
	try {
		res.json(await userEvent.setStatus(req.user.id, req.body.eventId, req.body.status));
	} catch (err) {
		console.error(`Error while updating event status`, err.message);
		next(err);
	}
});

router.post("/favorite", async function (req, res, next) {
	try {
		res.json(await userEvent.toggleFavorite(req.user.id, req.body.eventId, req.body.favorite));
	} catch (err) {
		console.error(`Error while updating event favorite`, err.message);
		next(err);
	}
});

router.post("/ticket", async function (req, res, next) {
	try {
		res.json(await userEvent.toggleTicket(req.user.id, req.body.eventId, req.body.hasTicket));
	} catch (err) {
		console.error(`Error while updating event ticket`, err.message);
		next(err);
	}
});

module.exports = router;
