const express = require("express");
const router = express.Router();
const artist = require("../services/artist");

/* GET artist. */
router.get("/", async function (req, res, next) {
	try {
		res.json(await artist.getMultiple(req.query.page, req.query.search, req.query.type));
	} catch (err) {
		console.error(`Error while getting artist `, err.message);
		next(err);
	}
});

/* POST artist */
router.post("/", async function (req, res, next) {
	try {
		res.json(await artist.create(req.body));
	} catch (err) {
		console.error(`Error while creating artist`, err.message);
		next(err);
	}
});

/* POST artist */
router.post("/create-bulk", async function (req, res, next) {
	try {
		res.json(await artist.createBulk(req.body));
	} catch (err) {
		console.error(`Error while creating artist`, err.message);
		next(err);
	}
});

/* PUT artist */
router.put("/:id", async function (req, res, next) {
	try {
		res.json(await artist.update(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while updating artist`, err.message);
		next(err);
	}
});

/* GET artist */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await artist.get(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while getting artist`, err.message);
		next(err);
	}
});

/* GET artist image */
router.get("/update-image/:id", async function (req, res, next) {
	try {
		res.json(await artist.updateSpotifyImage(req.params.id, req.body));
	} catch (err) {
		console.error(`Error while getting artist`, err.message);
		next(err);
	}
});

/* DELETE artist */
router.delete("/:id", async function (req, res, next) {
	try {
		res.json(await artist.remove(req.params.id));
	} catch (err) {
		console.error(`Error while deleting artist`, err.message);
		next(err);
	}
});

module.exports = router;
