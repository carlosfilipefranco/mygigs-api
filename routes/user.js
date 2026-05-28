const express = require("express");
const router = express.Router();
const user = require("../services/user");
const authService = require("../services/auth");
const { requireAuth } = require("../middleware/auth");

/* POST register */
router.post("/register", async function (req, res, next) {
	try {
		const userCreated = await user.create(req.body);
		const token = authService.generateToken(userCreated);
		res.json({ ...userCreated, token });
	} catch (err) {
		console.error("Error while registering user", err.message);
		next(err);
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

/* GET public user profile */
router.get("/:id", async function (req, res, next) {
	try {
		const profile = await user.getPublicProfile(req.params.id);
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
