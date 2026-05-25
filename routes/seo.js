const express = require("express");
const router = express.Router();
const seoService = require("../services/seo");
const config = require("../config");

function resolveSiteUrl(req) {
	const configuredSiteUrl = `${config?.seo?.siteUrl || ""}`.trim();
	if (configuredSiteUrl) {
		return configuredSiteUrl;
	}

	const forwardedProtoHeader = `${req.get("x-forwarded-proto") || ""}`.split(",")[0].trim();
	const protocol = forwardedProtoHeader || req.protocol || "https";
	const forwardedHostHeader = `${req.get("x-forwarded-host") || ""}`.split(",")[0].trim();
	const host = forwardedHostHeader || req.get("host");

	if (!host) {
		return "";
	}

	return `${protocol}://${host}`;
}

async function sendSitemap(req, res, next) {
	try {
		const siteUrl = resolveSiteUrl(req);
		const xml = await seoService.buildSitemap(siteUrl);
		res.set("Content-Type", "application/xml; charset=UTF-8");
		res.status(200).send(xml);
	} catch (err) {
		next(err);
	}
}

router.get("/sitemap.xml", sendSitemap);
router.get("/api/seo/sitemap.xml", sendSitemap);

module.exports = router;
