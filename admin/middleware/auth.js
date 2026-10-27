const users = require("../../services/user");

module.exports = async function isAdmin(req, res, next) {
	if (!req.session?.admin?.id || req.session.admin.role !== "admin") return res.redirect("/admin/login");
	try {
		const user = await users.get(req.session.admin.id);
		if (!user || user.role !== "admin") {
			delete req.session.admin;
			return res.redirect("/admin/login");
		}
		next();
	} catch (error) { next(error); }
};
