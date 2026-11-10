const fetch = require("node-fetch");
const { API_BASE_URL } = require("../config");
const adminTools = require("../../services/adminTools");

exports.users = async (req, res, next) => {
	try {
		const users = await adminTools.getUsers(req.query);
		res.set("Cache-Control", "no-store").render("users", {
			users, search: String(req.query.search || "").trim().slice(0, 150), active: "users"
		});
	} catch (error) { next(error); }
};

exports.dashboard = async (req, res) => {
	try {
		const [usersRes, ticketsRes] = await Promise.all([fetch(`${API_BASE_URL}/user/count`).then((r) => r.json()), fetch(`${API_BASE_URL}/user-gig/count`).then((r) => r.json())]);
		console.log(usersRes, ticketsRes);

		const stats = {
			users: 0,
			tickets: ticketsRes.total || 0
		};

		res.render("dashboard", { stats, active: "dashboard" });
	} catch (err) {
		console.error(err);
		res.status(500).send("Erro ao carregar o dashboard");
	}
};
