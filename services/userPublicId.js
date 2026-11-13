const { randomBytes } = require("node:crypto");

function isPublicId(value) {
	return typeof value === "string" && /^[A-Za-z0-9_-]{12}$/.test(value) && !/^\d+$/.test(value);
}

function createPublicId() {
	let publicId;
	do {
		// Nine random bytes produce exactly twelve URL-safe characters (72 bits).
		publicId = randomBytes(9).toString("base64url");
	} while (!isPublicId(publicId));
	return publicId;
}

async function withPublicId(write) {
	for (let attempt = 0; attempt < 10; attempt++) {
		const publicId = createPublicId();
		try {
			return { publicId, result: await write(publicId) };
		} catch (error) {
			// Other unique constraints, such as email, must retain their own errors.
			if (error.code !== "ER_DUP_ENTRY" || !String(error.sqlMessage || error.message).includes("user_public_id_unique")) throw error;
			if (attempt === 9) throw error;
		}
	}
}

module.exports = { isPublicId, createPublicId, withPublicId };
