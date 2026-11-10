const express = require("express");
const { requireAuth } = require("../middleware/auth");
const requestLimit = require("../middleware/requestLimit");
const users = require("../services/user");
const images = require("../services/imageUpload");
const router = express.Router();

router.post("/concert-list", requireAuth, requestLimit({ max: 10, windowMs: 60 * 60 * 1000 }),
	express.json({ limit: "7mb" }), async (req, res, next) => {
		try { res.status(201).json(await require("../services/submission").createFile(req.user.id, req.body)); }
		catch (error) { next(error); }
	});

router.post("/image", requireAuth, requestLimit({ max: 60, windowMs: 60 * 60 * 1000 }), async (req, res, next) => {
	try {
		if (!await users.get(req.user.id)) return res.status(401).json({ message: "A tua sessão deixou de ser válida." });
		next();
	} catch (error) { next(error); }
}, express.json({ limit: "14mb" }), async (req, res, next) => {
	try { res.json(await images.upload(req.body?.image)); }
	catch (error) { next(error); }
});

module.exports = router;
