const db = require("./db");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const fs = require("fs/promises");
const path = require("path");

const googleClient = new OAuth2Client();
const GOOGLE_CLIENT_ID_FALLBACK = "276222082601-rjqv1u7qlaqa5obmr6d882om73mlt3tl.apps.googleusercontent.com";
const profileUploadRoot = path.join(__dirname, "../public/uploads/users");
const profileUploadPath = "/uploads/users";
const maxProfileImageSize = 3 * 1024 * 1024;

module.exports = {
	create,
	login,
	loginWithGoogle,
	get,
	getPublicProfile,
	updateProfile,
	remove
};

async function create(user) {
	const { name, email, password } = user;

	// Hash seguro
	const passwordHash = await bcrypt.hash(password, 10);

	const result = await db.query(
		`
    INSERT INTO user (name, email, password_hash)
    VALUES (?, ?, ?)
    `,
		[name, email, passwordHash]
	);

	return {
		id: result.insertId,
		name,
		email,
		image: null,
		role: "user"
	};
}

async function login(email, password) {
	const users = await db.query(`SELECT * FROM user WHERE email = ?`, [email]);

	if (!users.length) return null;

	const user = users[0];

	const isValid = await bcrypt.compare(password, user.password_hash);

	if (!isValid) return null;

	return {
		id: user.id,
		name: user.name,
		email: user.email,
		image: user.image || null,
		role: user.role || "user"
	};
}

async function loginWithGoogle(payload) {
	const idToken = payload?.idToken;

	if (!idToken) {
		const error = new Error("Google token em falta");
		error.statusCode = 400;
		throw error;
	}

	const audience = getGoogleAudience();
	const ticket = await googleClient.verifyIdToken({
		idToken,
		audience
	});

	const tokenPayload = ticket.getPayload();
	const email = tokenPayload?.email?.trim().toLowerCase();
	const emailVerified = tokenPayload?.email_verified === true;

	if (!email || !emailVerified) {
		const error = new Error("Conta Google inválida");
		error.statusCode = 401;
		throw error;
	}

	const googleName = tokenPayload?.name?.trim();
	const googleImage = tokenPayload?.picture?.trim() || null;
	const fallbackName = email.split("@")[0];
	const safeName = (googleName || fallbackName || "Utilizador").slice(0, 255);
	const users = await db.query(`SELECT id, name, email, image, role FROM user WHERE email = ? LIMIT 1`, [email]);

	if (users.length) {
		const user = users[0];
		const image = user.image || googleImage || null;
		if (!user.image && googleImage) {
			await db.query(`UPDATE user SET image = ? WHERE id = ?`, [googleImage, user.id]);
		}

		return {
			id: user.id,
			name: user.name || safeName,
			email: user.email,
			image,
			role: user.role || "user"
		};
	}

	const generatedPasswordHash = await bcrypt.hash(`google-${tokenPayload?.sub || Date.now()}`, 10);
	const result = await db.query(
		`
		INSERT INTO user (name, email, image, password_hash)
		VALUES (?, ?, ?, ?)
		`,
		[safeName, email, googleImage, generatedPasswordHash]
	);

	return {
		id: result.insertId,
		name: safeName,
		email,
		image: googleImage,
		role: "user"
	};
}

function getGoogleAudience() {
	const envClientIds = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_IDS]
		.filter(Boolean)
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter(Boolean);

	if (envClientIds.length) {
		return envClientIds;
	}

	return [GOOGLE_CLIENT_ID_FALLBACK];
}

async function get(id) {
	const users = await db.query(`SELECT id, name, email, image, role, created_at FROM user WHERE id = ?`, [id]);

	return users.length ? users[0] : null;
}

async function getPublicProfile(id) {
	const userId = normalizeUserId(id);
	if (!userId) {
		return null;
	}

	const users = await db.query(`SELECT id, name, image, created_at FROM user WHERE id = ? LIMIT 1`, [userId]);
	if (!users.length) {
		return null;
	}

	const [statsRows, topArtists, recentGigs, upcomingGigs] = await Promise.all([
		db.query(
			`
			SELECT
				COUNT(DISTINCT CASE WHEN gig.date < CURDATE() THEN gig.id END) AS attended_gigs,
				COUNT(DISTINCT CASE WHEN gig.date >= CURDATE() THEN gig.id END) AS upcoming_gigs,
				COUNT(DISTINCT gig.artist_id) AS artists_seen,
				COUNT(DISTINCT edition.id) AS festival_editions
			FROM user_gig
			INNER JOIN gig ON user_gig.gig_id = gig.id
			LEFT JOIN event_gig ON event_gig.gig_id = gig.id
			LEFT JOIN edition_event ON edition_event.event_id = event_gig.event_id
			LEFT JOIN edition ON edition.id = edition_event.edition_id
			WHERE user_gig.user_id = ?
			  AND user_gig.status = 'going'
			  AND gig.type = 1
			`,
			[userId]
		),
		db.query(
			`
			SELECT artist.id, artist.name, artist.slug, artist.image, COUNT(DISTINCT gig.id) AS gig_count
			FROM user_gig
			INNER JOIN gig ON user_gig.gig_id = gig.id
			INNER JOIN artist ON artist.id = gig.artist_id
			WHERE user_gig.user_id = ?
			  AND user_gig.status = 'going'
			  AND gig.type = 1
			  AND gig.date < CURDATE()
			GROUP BY artist.id, artist.name, artist.slug, artist.image
			ORDER BY gig_count DESC, artist.name ASC
			LIMIT 10
			`,
			[userId]
		),
		db.query(
			`
			SELECT gig.id, gig.date, artist.id AS artist_id, artist.name AS artist, artist.slug AS artist_slug,
			       artist.image, venue.name AS venue, city.name AS city
			FROM user_gig
			INNER JOIN gig ON user_gig.gig_id = gig.id
			INNER JOIN artist ON artist.id = gig.artist_id
			INNER JOIN venue ON venue.id = gig.venue_id
			INNER JOIN city ON city.id = gig.city_id
			WHERE user_gig.user_id = ?
			  AND user_gig.status = 'going'
			  AND gig.type = 1
			  AND gig.date < CURDATE()
			ORDER BY gig.date DESC, gig.id DESC
			LIMIT 12
			`,
			[userId]
		),
		db.query(
			`
			SELECT gig.id, gig.date, artist.id AS artist_id, artist.name AS artist, artist.slug AS artist_slug,
			       artist.image, venue.name AS venue, city.name AS city
			FROM user_gig
			INNER JOIN gig ON user_gig.gig_id = gig.id
			INNER JOIN artist ON artist.id = gig.artist_id
			INNER JOIN venue ON venue.id = gig.venue_id
			INNER JOIN city ON city.id = gig.city_id
			WHERE user_gig.user_id = ?
			  AND user_gig.status = 'going'
			  AND gig.type = 1
			  AND gig.date >= CURDATE()
			ORDER BY gig.date ASC, gig.id ASC
			LIMIT 12
			`,
			[userId]
		)
	]);

	const stats = statsRows?.[0] || {};
	return {
		user: users[0],
		stats: {
			attended_gigs: Number(stats.attended_gigs || 0),
			upcoming_gigs: Number(stats.upcoming_gigs || 0),
			artists_seen: Number(stats.artists_seen || 0),
			festival_editions: Number(stats.festival_editions || 0)
		},
		top_artists: topArtists,
		recent_gigs: recentGigs,
		upcoming_gigs: upcomingGigs
	};
}

async function updateProfile(id, payload = {}) {
	const userId = normalizeUserId(id);
	if (!userId) {
		const error = new Error("Invalid user");
		error.statusCode = 400;
		throw error;
	}

	const users = await db.query(`SELECT id, name, email, image, role FROM user WHERE id = ? LIMIT 1`, [userId]);
	if (!users.length) {
		const error = new Error("User not found");
		error.statusCode = 404;
		throw error;
	}

	const image = await normalizeProfileImage(userId, payload.image, users[0].image);
	await db.query(`UPDATE user SET image = ? WHERE id = ?`, [image, userId]);

	return {
		id: users[0].id,
		name: users[0].name,
		email: users[0].email,
		image,
		role: users[0].role || "user"
	};
}

function normalizeUserId(id) {
	const parsed = Number(id);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function normalizeProfileImage(userId, image, previousImage) {
	if (image === null || image === undefined || `${image}`.trim() === "") {
		await cleanupProfileImages(userId);
		return null;
	}

	const value = `${image}`.trim();
	if (value.startsWith("data:image/")) {
		return storeProfileImage(userId, value);
	}

	if (value.startsWith(`${profileUploadPath}/`) || /^https?:\/\//i.test(value)) {
		if (previousImage && previousImage !== value && previousImage.startsWith(`${profileUploadPath}/`)) {
			await cleanupProfileImages(userId);
		}
		return value;
	}

	const error = new Error("Invalid profile image");
	error.statusCode = 400;
	throw error;
}

async function storeProfileImage(userId, dataUrl) {
	const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
	if (!match) {
		const error = new Error("Invalid profile image");
		error.statusCode = 400;
		throw error;
	}

	const mimeType = match[1].toLowerCase();
	const buffer = Buffer.from(match[2], "base64");
	if (!buffer.length || buffer.length > maxProfileImageSize) {
		const error = new Error("Profile image too large");
		error.statusCode = 400;
		throw error;
	}

	const extensionByMime = {
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif"
	};
	const extension = extensionByMime[mimeType];
	const filename = `${userId}-${Date.now()}.${extension}`;
	const filePath = path.join(profileUploadRoot, filename);
	const publicPath = `${profileUploadPath}/${filename}`;

	await fs.mkdir(profileUploadRoot, { recursive: true });
	await cleanupProfileImages(userId);
	await fs.writeFile(filePath, buffer);
	return publicPath;
}

async function cleanupProfileImages(userId) {
	try {
		const files = await fs.readdir(profileUploadRoot);
		await Promise.all(
			files
				.filter((file) => file.startsWith(`${userId}-`))
				.map((file) => fs.unlink(path.join(profileUploadRoot, file)).catch(() => null))
		);
	} catch {
		return null;
	}
}

async function remove(id) {
	const userId = Number(id);
	if (!Number.isFinite(userId) || userId <= 0) {
		const error = new Error("Invalid user");
		error.statusCode = 400;
		throw error;
	}

	const users = await db.query(`SELECT id FROM user WHERE id = ? LIMIT 1`, [userId]);
	if (!users.length) {
		const error = new Error("User not found");
		error.statusCode = 404;
		throw error;
	}

	await db.query(`DELETE FROM user_gig WHERE user_id = ?`, [userId]);
	await db.query(`DELETE FROM user_event WHERE user_id = ?`, [userId]);
	await db.query(`DELETE FROM user WHERE id = ?`, [userId]);
	await cleanupProfileImages(userId);

	return { message: "Account deleted successfully" };
}
