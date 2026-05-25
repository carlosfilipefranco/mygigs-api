const config = {
	db: {
		host: "autorack.proxy.rlwy.net",
		user: "root",
		password: "JTjmNVhzqmjFjdrUPxJqeYRivsDAfVAZ",
		database: "railway",
		port: 35936
	},
	// db: {
	// 	host: "127.0.0.1",
	// 	user: "root",
	// 	password: "root",
	// 	database: "mygigs"
	// },
	listPerPage: 20,
	seo: {
		siteUrl: process.env.SEO_SITE_URL || process.env.SITE_URL || "http://mygigs-04.web.app"
	}
};

module.exports = config;
