const fetch = require("node-fetch");
const { API_BASE_URL } = require("../config");

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
