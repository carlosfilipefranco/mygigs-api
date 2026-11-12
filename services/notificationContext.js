const { AsyncLocalStorage } = require('async_hooks');

const context = new AsyncLocalStorage();

function withNotificationActor(userId, next) {
	return context.run({ userId: Number(userId) }, next);
}

function notificationActor() { return context.getStore()?.userId || null; }

module.exports = { withNotificationActor, notificationActor };
