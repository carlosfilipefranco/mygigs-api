const router = require('express').Router();
const home = require('../services/home');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

router.get('/highlights', optionalAuth, async (req, res, next) => {
	try { res.set('Cache-Control', 'no-store').json(await home.highlights(req.query.type, req.user?.id, req.query)); }
	catch (error) { next(error); }
});

router.get('/featured', requireAdmin, async (req, res, next) => {
	try { res.set('Cache-Control', 'no-store').json({ featured: await home.getFeatured(home.eventType(req.query.type), req.user.id) }); }
	catch (error) { next(error); }
});

router.get('/featured/options', requireAdmin, async (req, res, next) => {
	try { res.set('Cache-Control', 'no-store').json(await home.options(req.query)); }
	catch (error) { next(error); }
});

router.put('/featured', requireAdmin, async (req, res, next) => {
	try { res.json(await home.save(req.body, req.user.id)); }
	catch (error) { next(error); }
});

module.exports = router;
