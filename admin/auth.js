const express = require("express");
const router = express.Router();
const users = require("../services/user");

router.get("/login", (req, res) => {
	res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
	try {
		const user = await users.login(req.body.email, req.body.password);
		if (!user || user.role !== "admin") {
			delete req.session.admin;
			return res.status(401).render("login", { error: "Credenciais inválidas" });
		}

		await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
		req.session.admin = { id: user.id, role: "admin" };
		await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
		res.redirect("/admin");
	} catch (err) {
		console.error(err);
		res.render("login", { error: "Erro no login." });
	}
});

router.get("/logout", (req, res) => {
	req.session.destroy(() => res.redirect("/admin/login"));
});

module.exports = router;
