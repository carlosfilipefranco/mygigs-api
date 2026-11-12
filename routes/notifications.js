const router = require('express').Router();
const notifications = require('../services/notifications');
const webPush = require('../services/webPush');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const handle = action => async (req, res, next) => {
	try { res.json(await action(req)); } catch (error) { next(error); }
};

router.get('/push/config', handle(() => webPush.publicConfiguration()));
router.post('/push/subscriptions', handle(req => webPush.subscribe(req.user.id, req.body?.subscription)));
router.delete('/push/subscriptions/:id', handle(req => webPush.unsubscribe(req.user.id, req.params.id)));

router.get('/settings', handle(req => notifications.settings(req.user.id)));
router.put('/settings', handle(req => notifications.savePreferences(req.user.id, req.body)));
router.get('/interests', handle(req => notifications.search(req.query.type, req.query.search)));
router.put('/follows/:type/:id', handle(req => notifications.follow(req.user.id, req.params.type, req.params.id)));
router.delete('/follows/:type/:id', handle(req => notifications.unfollow(req.user.id, req.params.type, req.params.id)));
router.get('/unread', handle(req => notifications.unreadCount(req.user.id)));
router.put('/read-all', handle(req => notifications.markAllRead(req.user.id, req.body?.through)));
router.put('/:id/read', handle(req => notifications.markRead(req.user.id, req.params.id)));
router.get('/', handle(req => notifications.list(req.user.id, req.query.before)));

module.exports = router;
