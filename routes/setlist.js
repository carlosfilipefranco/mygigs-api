const express = require("express");
const router = express.Router();
const setlistService = require("../services/setlist");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const requestLimit = require("../middleware/requestLimit");

/* GET setlists */
router.get("/", async function (req, res, next) {
	try {
		const data = await setlistService.getSetlist(req.query.gigId);
		res.json(data);
	} catch (err) {
		console.error("Erro ao obter setlist.fm:", err.message);
		next(err);
	}
});

router.post("/fetch", requireAuth, requestLimit({ max: 10, windowMs: 60 * 1000 }), async (req, res, next) => {
	try { res.json(await setlistService.fetchSetlist(req.body?.gigId)); }
	catch (error) { next(error); }
});

router.get("/import", requireAdmin, setlistService.importSetlists);
router.get("/import-cities", requireAdmin, async (req,res,next) => {
	try {res.json(await setlistService.importCities());} catch(error) {next(error);}
});
router.get("/import-venues", requireAdmin, setlistService.mergeDuplicateVenues);

router.get("/fetch-venues-pt", requireAdmin, async (req, res, next) => {
	try {
		await setlistService.fetchAllPortugalVenues();
		res.json({ success: true, message: "Fetch de venues em Portugal iniciado." });
	} catch (err) {
		console.error("Erro ao iniciar fetch de venues em Portugal:", err.message);
		next(err);
	}
});

module.exports = router;
