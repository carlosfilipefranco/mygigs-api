const db = require("./db");
const { slugify } = require("./slug");

const STATIC_PATHS = ["/", "/home", "/gigs", "/events", "/artists", "/festivals", "/venues", "/search", "/contact", "/privacy", "/terms"];

function normalizeSiteUrl(siteUrl) {
	return `${siteUrl || ""}`.trim().replace(/\/+$/, "");
}

function escapeXml(value) {
	return `${value || ""}`
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function toLastMod(value) {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.toISOString().slice(0, 10);
}

function buildIdentifier(row) {
	const numericId = Number(row?.id);
	if (!Number.isFinite(numericId) || numericId <= 0) {
		return null;
	}

	const resolvedSlug = `${row?.slug || ""}`.trim() || slugify(row?.name || "");
	return resolvedSlug ? `${numericId}-${resolvedSlug}` : `${numericId}`;
}

function buildLoc(siteUrl, path) {
	if (!path) {
		return siteUrl;
	}

	return path === "/" ? `${siteUrl}/` : `${siteUrl}${path}`;
}

function buildUrlEntry(siteUrl, path, lastMod = null) {
	const loc = buildLoc(siteUrl, path);
	return {
		loc,
		lastmod: toLastMod(lastMod)
	};
}

function toSitemapXml(entries) {
	const urls = entries
		.map((entry) => {
			const lastmodTag = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
			return `<url><loc>${escapeXml(entry.loc)}</loc>${lastmodTag}</url>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

async function buildSitemap(siteUrl) {
	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	if (!normalizedSiteUrl) {
		throw new Error("Missing site URL for sitemap generation");
	}

	const [artistRows, eventRows, festivalRows, editionRows] = await Promise.all([
		db.query(`SELECT id, name, slug FROM artist ORDER BY id DESC`),
		db.query(`SELECT id, name, slug, date FROM event ORDER BY date DESC, id DESC`),
		db.query(
			`SELECT festival.id, festival.name, festival.slug, MAX(COALESCE(edition.date_end, edition.date_start)) AS lastmod
			 FROM festival
			 LEFT JOIN edition ON edition.festival_id = festival.id
			 GROUP BY festival.id, festival.name, festival.slug
			 ORDER BY festival.id DESC`
		),
		db.query(`SELECT id, name, slug, date_start, date_end FROM edition ORDER BY COALESCE(date_end, date_start) DESC, id DESC`)
	]);

	const entries = [];
	const seen = new Set();
	const appendEntry = (entry) => {
		if (!entry?.loc || seen.has(entry.loc)) {
			return;
		}

		seen.add(entry.loc);
		entries.push(entry);
	};

	STATIC_PATHS.forEach((path) => {
		appendEntry(buildUrlEntry(normalizedSiteUrl, path));
	});

	artistRows.forEach((row) => {
		const identifier = buildIdentifier(row);
		if (!identifier) {
			return;
		}

		appendEntry(buildUrlEntry(normalizedSiteUrl, `/artist/${identifier}`));
	});

	eventRows.forEach((row) => {
		const identifier = buildIdentifier(row);
		if (!identifier) {
			return;
		}

		appendEntry(buildUrlEntry(normalizedSiteUrl, `/event/${identifier}`, row.date));
	});

	festivalRows.forEach((row) => {
		const identifier = buildIdentifier(row);
		if (!identifier) {
			return;
		}

		appendEntry(buildUrlEntry(normalizedSiteUrl, `/festival/${identifier}`, row.lastmod));
	});

	editionRows.forEach((row) => {
		const identifier = buildIdentifier(row);
		if (!identifier) {
			return;
		}

		appendEntry(buildUrlEntry(normalizedSiteUrl, `/editions/${identifier}`, row.date_end || row.date_start));
	});

	return toSitemapXml(entries);
}

module.exports = {
	buildSitemap
};
