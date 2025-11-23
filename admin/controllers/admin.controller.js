const fetch = require("node-fetch");

exports.dashboard = async (req, res) => {
	try {
		const base = "http://localhost:3001/api";

		const [usersRes, ticketsRes] = await Promise.all([fetch(`${base}/user/count`).then((r) => r.json()), fetch(`${base}/user-gig/count`).then((r) => r.json())]);

		console.log(usersRes, ticketsRes);

		const stats = {
			users: 0,
			tickets: ticketsRes.total || 0,
			revenue: "4.210€" // podes substituir quando tiveres endpoint
		};

		res.render("dashboard", { stats, active: "dashboard" });
	} catch (err) {
		console.error(err);
		res.status(500).send("Erro ao carregar o dashboard");
	}
};
