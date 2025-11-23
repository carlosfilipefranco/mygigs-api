const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const { API_BASE_URL } = require("./config");

router.get("/login", (req, res) => {
	res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
	try {
		const response = await fetch(`${API_BASE_URL}/user/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: req.body.email,
				password: req.body.password
			})
		});

		const data = await response.json();

		if (!data.token) {
			return res.render("login", { error: "Credenciais inválidas" });
		}

		req.session.admin = data;
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
