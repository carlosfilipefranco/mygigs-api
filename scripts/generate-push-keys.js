const fs = require('fs');
const path = require('path');
const { createECDH } = require('crypto');

const subject = process.argv[2];
if (!subject || !/^(mailto:|https:\/\/)/.test(subject)) {
	console.error('Usage: node scripts/generate-push-keys.js mailto:contact@example.com');
	process.exit(1);
}
const directory = path.join(__dirname, '../.secrets');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const keys = { subject, publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
const filename = path.join(directory, 'web-push.json');
fs.writeFileSync(filename, JSON.stringify(keys, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('VAPID credentials saved to .secrets/web-push.json (private, ignored by Git). Existing keys are never overwritten.');
