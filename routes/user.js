const express = require("express");
const router = express.Router();
const user = require("../services/user");
const authService = require("../services/auth");

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

/* GET user */
router.get("/:id", async function (req, res, next) {
	try {
		res.json(await user.get(req.params.id));
	} catch (err) {
		console.error("Error while fetching user", err.message);
		next(err);
	}
});

module.exports = router;
