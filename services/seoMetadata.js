const db = require("./db");
const { slugify, extractNumericId } = require("./slug");

const DEFAULT_API_ORIGIN = "https://mygigs-api-production.up.railway.app";
const DEFAULT_IMAGE = "/assets/icons/na-grade-512.png";
const dateFormatter = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Only public catalogue fields are selected; these queries never load user activity.
const sources = {
	concertos: {
		slug: false, alias: "g",
		select: `g.id, DATE_FORMAT(g.date, '%Y-%m-%d') AS date, a.name, a.image, a.type,
			COALESCE(va.name, v.name) AS venue, c.name AS city, a.id AS artist_id, a.slug AS artist_slug, v.id AS venue_id,
			DATE_FORMAT(period.date_start, '%Y-%m-%d') AS edition_date_start,
			DATE_FORMAT(period.date_end, '%Y-%m-%d') AS edition_date_end`,
		from: `gig g INNER JOIN artist a ON a.id = g.artist_id
			INNER JOIN venue v ON v.id = g.venue_id INNER JOIN city c ON c.id = g.city_id
			LEFT JOIN venue_alias va ON va.id = g.venue_alias_id AND va.venue_id = v.id
			LEFT JOIN (SELECT eg.gig_id, MIN(ed.date_start) AS date_start, MIN(ed.date_end) AS date_end
				FROM event_gig eg INNER JOIN edition_event ee ON ee.event_id = eg.event_id
				INNER JOIN edition ed ON ed.id = ee.edition_id GROUP BY eg.gig_id) period ON period.gig_id = g.id`
	},
	artistas: {
		slug: true, alias: "a",
		select: "a.id, a.name, a.slug, a.image, a.type, COALESCE(totals.total, 0) AS total",
		from: `artist a LEFT JOIN (SELECT artist_id, COUNT(*) AS total FROM gig GROUP BY artist_id) totals ON totals.artist_id = a.id`
	},
	festivais: {
		slug: true, alias: "f",
		select: "f.id, f.name, f.slug, f.image, COALESCE(totals.total, 0) AS total",
		from: `festival f LEFT JOIN (SELECT festival_id, COUNT(*) AS total FROM edition GROUP BY festival_id) totals ON totals.festival_id = f.id`
	},
	edicoes: {
		slug: true, alias: "ed",
		select: `ed.id, ed.name, ed.slug, COALESCE(NULLIF(ed.image, ''), f.image) AS image,
			DATE_FORMAT(ed.date_start, '%Y-%m-%d') AS date, DATE_FORMAT(ed.date_end, '%Y-%m-%d') AS date_end,
			ed.dates_confirmed, f.id AS festival_id, f.name AS festival_name, f.slug AS festival_slug,
			COALESCE(va.name, v.name) AS venue, c.name AS city, v.id AS venue_id`,
		from: `edition ed LEFT JOIN festival f ON f.id = ed.festival_id
			LEFT JOIN venue v ON v.id = ed.venue_id LEFT JOIN city c ON c.id = v.city_id
			LEFT JOIN venue_alias va ON va.id = ed.venue_alias_id AND va.venue_id = v.id`
	},
	eventos: {
		slug: true, alias: "ev",
		select: `ev.id, ev.name, ev.slug, ev.image, DATE_FORMAT(ev.date, '%Y-%m-%d') AS date,
			COALESCE(va.name, v.name) AS venue, c.name AS city, v.id AS venue_id`,
		from: `event ev LEFT JOIN venue v ON v.id = ev.venue_id LEFT JOIN city c ON c.id = v.city_id
			LEFT JOIN venue_alias va ON va.id = ev.venue_alias_id AND va.venue_id = v.id`
	},
	locais: {
		slug: false, alias: "v",
		select: "v.id, v.name, c.name AS city",
		from: "venue v LEFT JOIN city c ON c.id = v.city_id"
	}
};

function text(value) {
	return String(value || "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function identifier(row) {
	const slug = slugify(row.slug || row.name || "");
	return slug ? `${row.id}-${slug}` : `${row.id}`;
}

function publicImage(value, siteOrigin, apiOrigin) {
	try {
		const raw = String(value || "").trim();
		if (!raw || raw.length > 4096) return `${siteOrigin}${DEFAULT_IMAGE}`;
		const url = new URL(raw, raw.startsWith("/uploads/") ? apiOrigin : siteOrigin);
		if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
	} catch {}
	return `${siteOrigin}${DEFAULT_IMAGE}`;
}

function formatDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
	const date = new Date(`${value}T12:00:00Z`);
	return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

function formatPeriod(start, end) {
	const first = formatDate(start);
	const last = formatDate(end);
	return first && last && start !== end ? `${first} a ${last}` : first || last;
}

function makePage(type, row, siteOrigin, apiOrigin) {
	const source = sources[type];
	const name = text(row.name) || `Página ${row.id}`;
	const place = [text(row.venue), text(row.city)].filter(Boolean).join(", ");
	const date = formatDate(row.date);
	const path = `/${type}/${source.slug ? identifier(row) : row.id}`;
	const aliases = source.slug && path !== `/${type}/${row.id}` ? [`/${type}/${row.id}`] : [];
	const links = [{ path: `/${type === "edicoes" ? "festivais" : type}`, label: type === "edicoes" ? "Ver festivais" : `Ver ${type === "locais" ? "locais" : type}` }];
	let title;
	let summary;
	if (type === "concertos") {
		const kind = Number(row.type) === 2 ? "Espetáculo" : "Concerto";
		const schedule = date || `Dia por anunciar${row.edition_date_start ? ` · ${formatPeriod(row.edition_date_start, row.edition_date_end)}` : ""}`;
		title = [name, text(row.venue), schedule].filter(Boolean).join(" · ");
		summary = `${kind} de ${name}${place ? ` em ${place}` : ""}. ${date ? `Data: ${date}.` : `${schedule}.`} Consulta os detalhes, o alinhamento e as fotografias desta atuação.`;
		links.push({ path: `/artistas/${identifier({ id: row.artist_id, slug: row.artist_slug, name })}`, label: name });
	} else if (type === "artistas") {
		title = `${name} · ${Number(row.type) === 2 ? "Espetáculos" : "Concertos"} e histórico`;
		const total = Number(row.total) || 0;
		summary = `${name}: ${total} ${Number(row.type) === 2 ? (total === 1 ? "espetáculo registado" : "espetáculos registados") : (total === 1 ? "concerto registado" : "concertos registados")} no Na Grade. Consulta as próximas datas, o histórico de atuações, os locais e os festivais.`;
	} else if (type === "festivais") {
		title = `${name} · Edições, cartazes e concertos`;
		const total = Number(row.total) || 0;
		summary = `${name}: explora ${total} ${total === 1 ? "edição registada" : "edições registadas"}, os cartazes e o histórico de concertos. Descobre os artistas e as datas de cada edição.`;
	} else if (type === "edicoes") {
		const period = formatPeriod(row.date, row.date_end);
		title = `${name} · Cartaz${period ? ` · ${period}` : ""}`;
		summary = `${name}${row.festival_name && !name.includes(text(row.festival_name)) ? `, edição de ${text(row.festival_name)}` : ""}${place ? ` em ${place}` : ""}. ${period ? `${Number(row.dates_confirmed) === 1 ? "Datas" : "Período registado"}: ${period}. ` : ""}Consulta o cartaz e os concertos desta edição.`;
		if (row.festival_id) links.push({ path: `/festivais/${identifier({ id: row.festival_id, slug: row.festival_slug, name: row.festival_name })}`, label: text(row.festival_name) });
	} else if (type === "eventos") {
		title = [name, text(row.venue), date || "Data por anunciar"].filter(Boolean).join(" · ");
		summary = `${name}${place ? ` em ${place}` : ""}. ${date ? `Data: ${date}.` : "Data por anunciar."} Descobre o programa, os artistas e os concertos deste evento.`;
	} else {
		title = `${name}${row.city ? `, ${text(row.city)}` : ""} · Concertos e eventos`;
		summary = `${name}${row.city ? `, em ${text(row.city)}` : ""}: consulta os próximos concertos e eventos, o histórico de atuações e os artistas que passaram por este local.`;
	}
	if (row.venue_id) links.push({ path: `/locais/${row.venue_id}`, label: text(row.venue) });
	const image = publicImage(row.image, siteOrigin, apiOrigin);
	const description = summary.length > 190 ? `${summary.slice(0, 186).replace(/\s+\S*$/, "")}…` : summary;
	return {
		path, aliases, title: `${title} | Na Grade`, description, image, heading: name, summary, links,
		structuredData: { "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: `${siteOrigin}${path}`, image, inLanguage: "pt-PT", isPartOf: { "@type": "WebSite", name: "Na Grade", url: `${siteOrigin}/` } }
	};
}

async function rowsFor(type, id) {
	const source = sources[type];
	return db.query(`SELECT ${source.select} FROM ${source.from}${id ? ` WHERE ${source.alias}.id = ?` : ""} ORDER BY ${source.alias}.id`, id ? [id] : []);
}

function origins(siteUrl, apiUrl) {
	return { siteOrigin: new URL(siteUrl).origin, apiOrigin: new URL(apiUrl || DEFAULT_API_ORIGIN).origin };
}

async function getAllPageMetadata(siteUrl, apiUrl) {
	const { siteOrigin, apiOrigin } = origins(siteUrl, apiUrl);
	const groups = await Promise.all(Object.keys(sources).map(async type => {
		const rows = await rowsFor(type);
		return rows.map(row => makePage(type, row, siteOrigin, apiOrigin));
	}));
	return { siteOrigin, pages: groups.flat() };
}

async function getPageMetadata(pagePath, siteUrl, apiUrl) {
	const match = /^\/([a-z]+)\/([^/]+)\/?$/.exec(String(pagePath || ""));
	const type = match?.[1];
	const id = extractNumericId(match?.[2]);
	if (!Object.prototype.hasOwnProperty.call(sources, type) || !Number.isSafeInteger(id) || id <= 0) return null;
	const rows = await rowsFor(type, id);
	if (!rows.length) return null;
	const { siteOrigin, apiOrigin } = origins(siteUrl, apiUrl);
	return makePage(type, rows[0], siteOrigin, apiOrigin);
}

module.exports = { getAllPageMetadata, getPageMetadata };
