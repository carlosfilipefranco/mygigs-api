const { getAllPageMetadata } = require("./seoMetadata");

const STATIC_PATHS = ["/", "/concertos", "/eventos", "/artistas", "/festivais", "/locais", "/pesquisa", "/contacto", "/privacidade", "/termos"];

function escapeXml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

async function buildSitemap(siteUrl) {
	if (!siteUrl) throw new Error("Missing site URL for sitemap generation");
	const { siteOrigin, pages } = await getAllPageMetadata(siteUrl);
	const paths = [...new Set([...STATIC_PATHS, ...pages.map(page => page.path)])];
	// Event dates are not modification dates: omit lastmod until an actual update timestamp is available.
	const urls = paths.map(path => `<url><loc>${escapeXml(siteOrigin + path)}</loc></url>`).join("");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

module.exports = { buildSitemap };
