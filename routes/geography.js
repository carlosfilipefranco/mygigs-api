const router = require('express').Router();
const geography = require('../services/geography');
const { optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, async (req, res, next) => {
	try {
		if (req.query.scope === 'me') {
			if (!req.user) return res.status(401).json({ message: 'Inicia sessão para consultar os países do teu histórico.' });
			res.set('Cache-Control', 'private, no-store');
		}
		res.json(await geography.options(req.query, req.user?.id));
	}
	catch (error) { next(error); }
});

module.exports = router;
