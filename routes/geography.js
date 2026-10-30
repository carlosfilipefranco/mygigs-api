const router = require('express').Router();
const geography = require('../services/geography');

router.get('/', async (req, res, next) => {
	try { res.json(await geography.options(req.query)); }
	catch (error) { next(error); }
});

module.exports = router;
