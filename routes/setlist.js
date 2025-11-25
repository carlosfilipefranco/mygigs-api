const express = require("express");
const router = express.Router();
const setlistService = require("../services/setlist");

/* GET setlists */
router.get("/", async function (req, res, next) {
	try {
		const { gigId, artist, city, date } = req.query;
		const data = await setlistService.getSetlist(gigId, artist, city, date);
		res.json(data);
	} catch (err) {
		console.error("Erro ao obter setlist.fm:", err.message);
		next(err);
	}
});

router.get("/import", setlistService.importSetlists);
router.get("/import-cities", setlistService.importCities);
router.get("/import-venues", setlistService.mergeDuplicateVenues);

router.get("/fetch-venues-pt", async (req, res, next) => {
	try {
		await setlistService.fetchAllPortugalVenues();
		res.json({ success: true, message: "Fetch de venues em Portugal iniciado." });
	} catch (err) {
		console.error("Erro ao iniciar fetch de venues em Portugal:", err.message);
		next(err);
	}
});

module.exports = router;
