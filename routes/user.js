const express = require("express");
const router = express.Router();
const user = require("../services/user");
const authService = require("../services/auth");
const { requireAuth } = require("../middleware/auth");
const passwordReset = require("../services/passwordReset");
const registration = require("../services/registration");
const requestLimit = require("../middleware/requestLimit");

const recoveryLimit = requestLimit({ max: 10, windowMs: 15 * 60 * 1000, key: req => req.ip });
const resetLimit = requestLimit({ max: 30, windowMs: 15 * 60 * 1000, key: req => req.ip });

router.post("/forgot-password", recoveryLimit, async (req, res, next) => {
	res.set("Cache-Control", "no-store");
	try {
		const startedAt = Date.now();
		const result = await passwordReset.requestReset(req.body || {});
		// Evitar uma resposta imediata para emails desconhecidos ou pedidos repetidos.
		await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - startedAt))));
		res.json(result);
	} catch (error) { next(error); }
});

router.post("/verify-reset-code", resetLimit, async (req, res, next) => {
	res.set("Cache-Control", "no-store");
	try {
		res.json(await passwordReset.verifyResetCode(req.body || {}));
	} catch (error) {
		if (error.code === "INVALID_RESET_CODE") return res.status(400).json({ message: error.message, code: error.code });
		next(error);
	}
});

router.post("/reset-password", resetLimit, async (req, res, next) => {
	res.set("Cache-Control", "no-store");
	try {
		res.json(await passwordReset.resetPassword(req.body || {}));
	} catch (error) {
		if (error.code === "INVALID_RESET_CODE") return res.status(400).json({ message: error.message, code: error.code });
		next(error);
	}
});

const registrationCodeLimit = requestLimit({ max: 10, windowMs: 15 * 60 * 1000, key: req => req.ip });
const registrationLimit = requestLimit({ max: 30, windowMs: 15 * 60 * 1000, key: req => req.ip });

function registrationError(err, res, next) {
	const codes = new Set(["EMAIL_ALREADY_EXISTS", "INVALID_REGISTRATION_CODE", "INVALID_EMAIL", "INVALID_NAME", "INVALID_PASSWORD", "EMAIL_DELIVERY_FAILED", "REGISTRATION_RATE_LIMITED"]);
	if (!codes.has(err.code)) return next(err);
	if (err.retryAfter) res.set("Retry-After", String(err.retryAfter));
	return res.status(err.statusCode).json({ message: err.message, code: err.code });
}

router.post("/registration-code", registrationCodeLimit, async (req, res, next) => {
	res.set("Cache-Control", "no-store");
	try {
		res.json(await registration.requestCode(req.body || {}));
	} catch (err) { registrationError(err, res, next); }
});

/* A conta e o token só são criados depois de consumir um código válido. */
router.post("/register", registrationLimit, async function (req, res, next) {
	res.set("Cache-Control", "no-store");
	try {
		const userCreated = await user.create(req.body || {});
		const token = authService.generateToken(userCreated);
		res.json({ ...userCreated, token });
	} catch (err) {
		registrationError(err, res, next);
	}
});

/* POST login */
router.post("/login", async function (req, res, next) {
	try {
		const { email, password } = req.body;
		const userLogged = await user.login(email, password);
		if (!userLogged) {
			return res.status(401).json({ message: "Invalid credentials" });
		}

		const token = authService.generateToken(userLogged);
		res.json({ ...userLogged, token });
	} catch (err) {
		console.error("Error while logging in", err.message);
		next(err);
	}
});

/* POST google login/register */
router.post("/google", async function (req, res, next) {
	try {
		const userLogged = await user.loginWithGoogle(req.body);
		const token = authService.generateToken(userLogged);
		res.json({ ...userLogged, token });
	} catch (err) {
		console.error("Error while logging in with Google", err.message);
		next(err);
	}
});

/* Validar a sessão e substituir os tokens antigos por um token persistente. */
router.post("/session", requireAuth, async function (req, res, next) {
	try {
		const currentUser = await user.get(req.user.id);
		if (!currentUser || Number(currentUser.auth_version) !== (req.user.authVersion ?? 0)) {
			return res.status(401).json({ message: "Session is no longer valid" });
		}
		res.set("Cache-Control", "no-store");
		res.json({ ...currentUser, token: authService.generateToken(currentUser) });
	} catch (err) {
		next(err);
	}
});

/* GET current user */
router.get("/me", requireAuth, async function (req, res, next) {
	try {
		res.json(await user.get(req.user.id));
	} catch (err) {
		console.error("Error while fetching current user", err.message);
		next(err);
	}
});

/* PUT current user profile */
router.put("/me", requireAuth, async function (req, res, next) {
	try {
		res.json(await user.updateProfile(req.user.id, req.body));
	} catch (err) {
		console.error("Error while updating user profile", err.message);
		next(err);
	}
});

/* DELETE current user account */
router.delete("/me", requireAuth, async function (req, res, next) {
	try {
		res.json(await user.remove(req.user.id));
	} catch (err) {
		console.error("Error while deleting user account", err.message);
		next(err);
	}
});

/* Fotografias públicas de concertos adicionadas pelo utilizador. */
router.get("/:publicId/photos", async function (req, res, next) {
	try {
		const photos = await user.getPublicPhotos(req.params.publicId, req.query.page);
		if (!photos) return res.status(404).json({ message: "User not found" });
		res.json(photos);
	} catch (err) {
		next(err);
	}
});

router.get("/:publicId/countries/:code/gigs", async function (req, res, next) {
	try {
		const result = await user.getCountryGigs(req.params.publicId, req.params.code, req.query.page);
		if (!result) return res.status(404).json({ message: "User not found" });
		res.json(result);
	} catch (err) {
		next(err);
	}
});

/* GET public user profile */
router.get("/:publicId", async function (req, res, next) {
	try {
		const profile = await user.getPublicProfile(req.params.publicId);
		if (!profile) {
			return res.status(404).json({ message: "User not found" });
		}

		res.json(profile);
	} catch (err) {
		console.error("Error while fetching user", err.message);
		next(err);
	}
});

module.exports = router;
