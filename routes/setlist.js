const express = require("express");
const router = express.Router();
const setlistService = require("../services/setlist");

/* GET setlists */
router.get("/", async function (req, res, next) {
	try {
		const { artist, city, date } = req.query;
		const data = await setlistService.getSetlist(artist, city, date);
		res.json(data);
	} catch (err) {
		console.error("Erro ao obter setlist.fm:", err.message);
		next(err);
	}
});

module.exports = router;
