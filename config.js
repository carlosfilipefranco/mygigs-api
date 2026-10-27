const legacy = require("./services/legacyConfig");

const config = {
	get db() {
		const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
		let url;
		if (databaseUrl) {
			try { url = new URL(databaseUrl); }
			catch { throw new Error("DATABASE_URL/MYSQL_URL inválido."); }
			if (url.protocol !== "mysql:") throw new Error("A ligação à base de dados deve usar mysql:.");
		}
		const db = {
			host: process.env.DB_HOST || process.env.MYSQLHOST || url?.hostname || legacy.db.host,
			user: process.env.DB_USER || process.env.MYSQLUSER || (url && decodeURIComponent(url.username)) || legacy.db.user,
			password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || (url && decodeURIComponent(url.password)) || legacy.db.password,
			database: process.env.DB_NAME || process.env.MYSQLDATABASE || (url && decodeURIComponent(url.pathname.slice(1))) || legacy.db.database,
			port: Number(process.env.DB_PORT || process.env.MYSQLPORT || url?.port || legacy.db.port)
		};
		if (!db.host || !db.user || !db.password || !db.database || !Number.isInteger(db.port) || db.port < 1 || db.port > 65535) {
			throw new Error("Configura a ligação MySQL através das variáveis DB_* ou MYSQL*.");
		}
		return db;
	},
	listPerPage: 20,
	seo: {
		siteUrl: process.env.SEO_SITE_URL || process.env.SITE_URL || "https://mygigs-04.web.app"
	}
};

module.exports = config;
