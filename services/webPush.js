const { createECDH, createHash, randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

let library;
let workerTimer;
let working = false;

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }

function configuration() {
	let saved = {};
	const filename = path.join(__dirname, '../.secrets/web-push.json');
	if (fs.existsSync(filename)) saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
	const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY || saved.publicKey;
	const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY || saved.privateKey;
	const subject = process.env.PUSH_VAPID_SUBJECT || saved.subject;
	if (!publicKey && !privateKey && !subject) return null;
	try {
		if (typeof publicKey !== 'string' || typeof privateKey !== 'string' || typeof subject !== 'string') throw new Error();
		const ecdh = createECDH('prime256v1');
		ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
		if (ecdh.getPublicKey().toString('base64url') !== publicKey) throw new Error();
		const contact = new URL(subject);
		if (!['https:', 'mailto:'].includes(contact.protocol)) throw new Error();
	} catch { fail('A configuração de envio de push não é válida.', 503); }
	return { publicKey, privateKey, subject };
}

function publicConfiguration() {
	const config = configuration();
	return { enabled: !!config, publicKey: config?.publicKey || null };
}

function validateSubscription(input) {
	if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2048) fail('Subscrição inválida.');
	let url;
	try { url = new URL(input.endpoint); } catch { fail('Endereço de push inválido.'); }
	// Only provider-owned public endpoints are accepted; never make requests to arbitrary URLs.
	const host = url.hostname.toLowerCase();
	const allowed = host === 'fcm.googleapis.com' || host === 'push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
		|| host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
	if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) fail('Fornecedor de push não suportado.');
	for (const [key, length] of [['p256dh', 65], ['auth', 16]]) {
		const value = input.keys?.[key];
		if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || Buffer.from(value, 'base64url').length !== length) fail('Chaves de subscrição inválidas.');
	}
	if (Buffer.from(input.keys.p256dh, 'base64url')[0] !== 4) fail('Chave de subscrição inválida.');
	return { endpoint: url.href, p256dh: input.keys.p256dh, auth: input.keys.auth };
}

async function subscribe(userId, input) {
	if (!configuration()) fail('O envio de push ainda não está configurado.', 503);
	const subscription = validateSubscription(input);
	const hash = createHash('sha256').update(subscription.endpoint).digest('hex');
	return db.transaction(async query => {
		// Serializes registrations by this user without modifying their notification preferences.
		await query('SELECT id FROM user WHERE id = ? FOR UPDATE', [userId]);
		const existing = await query('SELECT id, user_id FROM user_push_subscription WHERE endpoint_hash = ? FOR UPDATE', [hash]);
		if (!existing.length || Number(existing[0].user_id) !== Number(userId)) {
			const count = await query('SELECT COUNT(*) AS total FROM user_push_subscription WHERE user_id = ?', [userId]);
			if (count[0].total >= 20) fail('Atingiste o limite de dispositivos com push activo.');
		}
		// A browser belongs to one account at a time. Drop queued deliveries on reassignment.
		if (existing.length && Number(existing[0].user_id) !== Number(userId)) {
			await query('DELETE FROM user_push_delivery WHERE subscription_id = ?', [existing[0].id]);
		}
		const id = existing[0]?.id || randomUUID();
		await query(`INSERT INTO user_push_subscription (id, user_id, endpoint_hash, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), last_seen_at = CURRENT_TIMESTAMP`,
			[id, userId, hash, subscription.endpoint, subscription.p256dh, subscription.auth]);
		return { id };
	});
}

async function unsubscribe(userId, id) {
	if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) fail('Identificador de dispositivo inválido.');
	await db.query('DELETE FROM user_push_subscription WHERE id = ? AND user_id = ?', [id, userId]);
	return { removed: true };
}

async function enqueue(query, eventKey) {
	await query(`INSERT IGNORE INTO user_push_delivery (notification_id, subscription_id)
		SELECT n.id, s.id FROM user_notification n INNER JOIN user_push_subscription s ON s.user_id = n.user_id
		WHERE n.event_key = ?`, [eventKey]);
}

async function claim() {
	return db.transaction(async query => {
		const rows = await query(`SELECT id FROM user_push_delivery WHERE attempts < 6 AND available_at <= CURRENT_TIMESTAMP
			AND (status = 'pending' OR (status = 'sending' AND locked_until < CURRENT_TIMESTAMP)) ORDER BY id LIMIT 1 FOR UPDATE`);
		if (!rows.length) return null;
		const token = randomUUID();
		await query(`UPDATE user_push_delivery SET status = 'sending', attempts = attempts + 1, lock_token = ?,
			locked_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE) WHERE id = ?`, [token, rows[0].id]);
		const tasks = await query(`SELECT d.id, d.attempts, d.lock_token, n.id AS notification_id, n.user_id, n.title, n.body, n.path,
			s.id AS subscription_id, s.endpoint, s.p256dh, s.auth,
			(n.read_at IS NULL AND n.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)
			 AND s.user_id = n.user_id AND p.enabled = 1
			 AND ((n.kind = 'new_concerts' AND p.new_concerts = 1) OR (n.kind = 'gig_changes' AND p.gig_changes = 1))) AS should_send
			FROM user_push_delivery d INNER JOIN user_notification n ON n.id = d.notification_id
			INNER JOIN user_push_subscription s ON s.id = d.subscription_id
			LEFT JOIN user_notification_preferences p ON p.user_id = n.user_id WHERE d.id = ?`, [rows[0].id]);
		return tasks[0] || null;
	});
}

async function complete(task, status, error = null, delay = 0) {
	await db.query(`UPDATE user_push_delivery SET status = ?, locked_until = NULL, lock_token = NULL, last_error = ?,
		available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND), sent_at = IF(? = 'sent', CURRENT_TIMESTAMP, NULL)
		WHERE id = ? AND lock_token = ?`, [status, error, delay, status, task.id, task.lock_token]);
}

async function send(task, config) {
	if (!task.should_send) return complete(task, 'cancelled');
	try {
		library ||= import('web-push');
		const webPush = await library;
		await webPush.sendNotification({ endpoint: task.endpoint, keys: { p256dh: task.p256dh, auth: task.auth } }, JSON.stringify({
			title: task.title, body: task.body.slice(0, 500), path: task.path, notificationId: String(task.notification_id)
		}), { vapidDetails: config, TTL: 86400, urgency: 'normal', timeout: 15000 });
		await complete(task, 'sent');
	} catch (error) {
		if ([404, 410].includes(error.statusCode)) {
			await db.query('DELETE FROM user_push_subscription WHERE id = ? AND user_id = ?', [task.subscription_id, task.user_id]);
			return;
		}
		const retry = task.attempts < 6 && (!error.statusCode || error.statusCode === 429 || error.statusCode >= 500);
		await complete(task, retry ? 'pending' : 'failed', String(error.statusCode || error.code || 'SEND_FAILED').slice(0, 64), Math.min(3600, 30 * 2 ** task.attempts));
		// Provider error messages can contain the endpoint; log only the code and delivery ID.
		console.error('Web Push delivery failed', { id: task.id, code: error.statusCode || error.code || 'SEND_FAILED' });
	}
}

async function drain() {
	if (working) return;
	working = true;
	try {
		const config = configuration();
		if (!config) return;
		await db.query(`UPDATE user_push_delivery SET status = 'failed', lock_token = NULL, locked_until = NULL,
			last_error = 'RETRY_LIMIT' WHERE status = 'sending' AND attempts >= 6 AND locked_until < CURRENT_TIMESTAMP`);
		for (let i = 0; i < 25; i++) {
			const task = await claim();
			if (!task) break;
			await send(task, config);
		}
	} catch (error) { console.error('Web Push queue unavailable', { code: error.code || 'PUSH_CONFIG_OR_DATABASE' }); }
	finally { working = false; }
}

function startWorker() {
	if (workerTimer || !(process.env.PUSH_WORKER_ENABLED === 'true' || (process.env.PUSH_WORKER_ENABLED === undefined && process.env.NODE_ENV === 'production'))) return;
	if (!configuration()) { console.info('Web Push disabled: configure VAPID credentials.'); return; }
	workerTimer = setInterval(() => void drain(), 5000);
	workerTimer.unref();
	void drain();
}

module.exports = { publicConfiguration, subscribe, unsubscribe, enqueue, startWorker };
