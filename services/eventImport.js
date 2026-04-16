const http = require("http");
const https = require("https");
const db = require("./db");

const MONTHS = {
	jan: 1,
	janeiro: 1,
	fev: 2,
	fevereiro: 2,
	mar: 3,
	marco: 3,
	"março": 3,
	abr: 4,
	abril: 4,
	mai: 5,
	maio: 5,
	jun: 6,
	junho: 6,
	jul: 7,
	julho: 7,
	ago: 8,
	agosto: 8,
	set: 9,
	setembro: 9,
	out: 10,
	outubro: 10,
	nov: 11,
	novembro: 11,
	dez: 12,
	dezembro: 12
};

function normalize(value = "") {
	return value
		.toString()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function decodeHtml(value = "") {
	const namedEntities = {
		Aacute: "Á",
		aacute: "á",
		Agrave: "À",
		agrave: "à",
		Acirc: "Â",
		acirc: "â",
		Atilde: "Ã",
		atilde: "ã",
		Eacute: "É",
		eacute: "é",
		Egrave: "È",
		egrave: "è",
		Ecirc: "Ê",
		ecirc: "ê",
		Iacute: "Í",
		iacute: "í",
		Oacute: "Ó",
		oacute: "ó",
		Ocirc: "Ô",
		ocirc: "ô",
		Otilde: "Õ",
		otilde: "õ",
		Uacute: "Ú",
		uacute: "ú",
		Ccedil: "Ç",
		ccedil: "ç",
		ldquo: '"',
		rdquo: '"',
		lsquo: "'",
		rsquo: "'",
		ndash: "-",
		mdash: "-"
	};

	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&([a-zA-Z]+);/g, (match, entity) => namedEntities[entity] || match)
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanText(value = "") {
	return decodeHtml(value)
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function fetchHtml(url, redirectCount = 0) {
	return new Promise((resolve, reject) => {
		const parsedUrl = new URL(url);
		const client = parsedUrl.protocol === "http:" ? http : https;
		const request = client.request(
			parsedUrl,
			{
				headers: {
					"User-Agent": "Mozilla/5.0 MyGigs importer",
					"Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8"
				},
				insecureHTTPParser: true,
				timeout: 30000
			},
			(response) => {
				const location = response.headers.location;

				if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && redirectCount < 5) {
					response.resume();
					resolve(fetchHtml(new URL(location, url).toString(), redirectCount + 1));
					return;
				}

				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					resolve({
						statusCode: response.statusCode,
						body: Buffer.concat(chunks).toString("utf8")
					});
				});
			}
		);

		request.on("timeout", () => request.destroy(new Error("Timeout ao ler o evento.")));
		request.on("error", reject);
		request.end();
	});
}

function stripHtml(html = "") {
	return decodeHtml(
		html
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol)\b[^>]*>/gi, "\n")
			.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol)>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	)
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s+/g, "\n")
		.replace(/\s+\n/g, "\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

function getMetaContent(html, key) {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const patterns = [
		new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
		new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, "i")
	];

	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) {
			return cleanText(match[1]);
		}
	}

	return null;
}

function getTitleTag(html) {
	return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function getTitle(html, lines) {
	const metaTitle = getMetaContent(html, "og:title");
	const titleTag = getTitleTag(html);
	const title = cleanText(metaTitle || titleTag || "");

	if (title) {
		return title.replace(/^bilhetes\s+/i, "").replace(/\s+-\s+ticketline$/i, "").trim();
	}

	return lines.find((line) => line.length > 2 && line === line.toUpperCase()) || null;
}

function getFirstClassText(html, className) {
	const pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
	const match = html.match(pattern);

	return match?.[1] ? cleanText(stripHtml(match[1])) : "";
}

function getLineIndex(lines, value, start = 0) {
	const normalizedValue = normalize(value);
	return lines.findIndex((line, index) => index >= start && normalize(line) === normalizedValue);
}

function getLastLineIndex(lines, value) {
	const normalizedValue = normalize(value);

	for (let i = lines.length - 1; i >= 0; i--) {
		if (normalize(lines[i]) === normalizedValue) {
			return i;
		}
	}

	return -1;
}

function getDescription(lines) {
	const descriptionIndex = getLastLineIndex(lines, "Descrição");

	if (descriptionIndex === -1) {
		return "";
	}

	const endIndex = lines.findIndex((line, index) => index > descriptionIndex && ["comprar bilhetes", "promotor"].includes(normalize(line)));
	const descriptionLines = lines.slice(descriptionIndex + 1, endIndex === -1 ? lines.length : endIndex);

	return descriptionLines.join("\n").trim();
}

function getNotes(lines) {
	const notesIndex = getLineIndex(lines, "Notas");

	if (notesIndex === -1) {
		return "";
	}

	const endIndex = lines.findIndex((line, index) => index > notesIndex && ["sessoes", "sessões", "descricao", "descrição"].includes(normalize(line)));
	return lines
		.slice(notesIndex + 1, endIndex === -1 ? lines.length : endIndex)
		.filter((line) => !/^sessões?\s*\(/i.test(line))
		.join("\n")
		.trim();
}

function getPromoter(lines) {
	const promoterIndex = getLineIndex(lines, "Promotor");
	return promoterIndex !== -1 ? lines[promoterIndex + 1] || "" : "";
}

function getSessionLine(lines) {
	const sessionsIndex = getLineIndex(lines, "Sessões");
	const start = sessionsIndex === -1 ? 0 : sessionsIndex + 1;

	return lines.find((line, index) => {
		return index >= start && /\b\d{1,2}:\d{2}\b/.test(line) && (line.includes("€") || normalize(line).includes("comprar"));
	});
}

function removeBuySuffix(value = "") {
	return value.replace(/\s*(?:ℹ️?\s*)?comprar\s*$/i, "").trim();
}

function getSessionParts(sessionLine = "") {
	const match = sessionLine.match(/\b([^\s]+)\s+(\d{1,2})\s+[^\s]+\s+(\d{1,2}:\d{2})\s+(.+)$/i);

	if (!match) {
		return {};
	}

	const [, monthLabel, day, time, rest] = match;
	const sessionText = removeBuySuffix(rest);
	const priceIndex = sessionText.search(/\d[\d.,]*\s*€/);
	const location = cleanText(priceIndex === -1 ? sessionText : sessionText.slice(0, priceIndex));
	const price = priceIndex === -1 ? "" : cleanText(sessionText.slice(priceIndex));

	return {
		day: Number(day),
		month: MONTHS[normalize(monthLabel)],
		time,
		location,
		price
	};
}

function getYear(text, day, month) {
	const monthNames = Object.keys(MONTHS).join("|");
	const datePattern = new RegExp(`\\b${day}\\s+de\\s+(${monthNames})\\s+de\\s+(\\d{4})\\b`, "i");
	const dateMatch = text.match(datePattern);

	if (dateMatch && MONTHS[normalize(dateMatch[1])] === month) {
		return Number(dateMatch[2]);
	}

	const currentYear = new Date().getFullYear();
	const today = new Date();
	const candidate = new Date(currentYear, month - 1, day);

	return candidate >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) ? currentYear : currentYear + 1;
}

function formatDate(day, month, year) {
	if (!day || !month || !year) {
		return null;
	}

	return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function getSessionTitleParts(html) {
	const title = getTitleTag(html).replace(/\s+/g, " ");
	const titleMatch = title.match(/^Bilhetes\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(\d{1,2}:\d{2})\s+(\d{1,2})\s+([^\s]+)\s+(\d{4})\s+-\s+(.+?)\s+-\s+Ticketline$/i);

	if (titleMatch) {
		return {
			cityName: cleanText(titleMatch[1]),
			name: cleanText(titleMatch[2]),
			time: titleMatch[3],
			day: Number(titleMatch[4]),
			month: MONTHS[normalize(titleMatch[5])],
			year: Number(titleMatch[6]),
			location: cleanText(titleMatch[7])
		};
	}

	const sessionTitle = getFirstClassText(html, "title");
	const titleParts = sessionTitle.split("|").map((part) => cleanText(part));

	if (titleParts.length >= 2) {
		return {
			cityName: titleParts[0],
			name: titleParts.slice(1).join(" | ")
		};
	}

	return {};
}

function parseMoney(value) {
	return Number(value.replace(/\./g, "").replace(",", "."));
}

function formatMoney(value) {
	return `${value.toFixed(2).replace(".", ",")}€`;
}

function getSessionPriceRange(html) {
	const start = html.indexOf('id="venueZonesList"');
	const end = start === -1 ? -1 : html.indexOf('<p class="legal_info"', start);

	if (start === -1 || end === -1) {
		return "";
	}

	const section = html.slice(start, end);
	const prices = [...section.matchAll(/<p[^>]+class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
		.map((match) => stripHtml(match[1]).match(/(\d[\d.,]*)\s*€/)?.[1])
		.filter(Boolean)
		.map(parseMoney)
		.filter((value) => !Number.isNaN(value));

	if (!prices.length) {
		return "";
	}

	const uniquePrices = [...new Set(prices)];
	const min = Math.min(...uniquePrices);
	const max = Math.max(...uniquePrices);

	return min === max ? formatMoney(min) : `${formatMoney(min)} a ${formatMoney(max)}`;
}

function getSessionPageData(html, text) {
	if (!/\/sessao\//i.test(getMetaContent(html, "og:url") || "") && !/context_session_detail/i.test(html)) {
		return {};
	}

	const titleParts = getSessionTitleParts(html);
	const monthLabel = getFirstClassText(html, "month");
	const day = Number(getFirstClassText(html, "day"));
	const time = getFirstClassText(html, "time");
	const location = getFirstClassText(html, "location");
	const month = MONTHS[normalize(monthLabel)] || titleParts.month;
	const year = titleParts.year || (day && month ? getYear(text, day, month) : null);

	return {
		...titleParts,
		day: day || titleParts.day,
		month,
		year,
		time: time || titleParts.time,
		location: location || titleParts.location,
		price: getSessionPriceRange(html)
	};
}

function getEventPageData(html) {
	if (/context_session_detail/i.test(html)) {
		return {};
	}

	const sessionsIndex = html.search(/<ul[^>]+class=["'][^"']*\bsessions_list\b/i);

	if (sessionsIndex === -1) {
		return {};
	}

	const sessionEnd = html.indexOf("</li>", sessionsIndex);
	const section = html.slice(sessionsIndex, sessionEnd === -1 ? undefined : sessionEnd);
	const startDate = section.match(/itemprop=["']startDate["'][^>]+content=["']([^"']+)["']/i)?.[1] || section.match(/content=["']([^"']+)["'][^>]+itemprop=["']startDate["']/i)?.[1] || "";
	const dateMatch = startDate.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}:\d{2}))?/);
	const venueName = section.match(/<p[^>]+class=["'][^"']*\bvenue\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
	const cityName = section.match(/<span[^>]+class=["'][^"']*\bcity\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
	const districtName = section.match(/<span[^>]+class=["'][^"']*\bdistrict\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
	const priceText = stripHtml(section.match(/<p[^>]+class=["'][^"']*\bprice_range\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
	const prices = [...priceText.matchAll(/(\d[\d.,]*)\s*€/g)].slice(0, 2).map((match) => `${match[1]}€`);

	return {
		day: dateMatch ? Number(dateMatch[3]) : null,
		month: dateMatch ? Number(dateMatch[2]) : null,
		year: dateMatch ? Number(dateMatch[1]) : null,
		time: dateMatch?.[4] || null,
		location: venueName ? cleanText(venueName) : "",
		cityName: cleanText(cityName || districtName || ""),
		price: prices.length === 2 ? `${prices[0]} a ${prices[1]}` : prices[0] || ""
	};
}

function getBolDate(description, html) {
	const metaDate = description.match(/(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?(?:às|as)\s*(\d{1,2})h(\d{2})/i);

	if (metaDate) {
		return {
			date: `${metaDate[1]}/${metaDate[2]}/${metaDate[3]}`,
			time: `${metaDate[4].padStart(2, "0")}:${metaDate[5]}`
		};
	}

	const visibleText = stripHtml(html);
	const visibleDate = visibleText.match(/\b(\d{1,2})\s+([a-zç]+)\s+(\d{4})\s*\|\s*(\d{1,2}:\d{2})\b/i);

	if (!visibleDate) {
		return {};
	}

	return {
		date: formatDate(Number(visibleDate[1]), MONTHS[normalize(visibleDate[2])], Number(visibleDate[3])),
		time: visibleDate[4]
	};
}

function getBolPriceRange(html) {
	const availableRows = [...html.matchAll(/<tr[^>]+class=["'][^"']*\bdisponivel\b[^"']*["'][\s\S]*?<\/tr>/gi)];
	const priceMatches = availableRows.length ? availableRows : [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)];
	const prices = priceMatches
		.map((match) => stripHtml(match[0]).match(/(\d[\d.,]*)\s*€/)?.[1])
		.filter(Boolean)
		.map(parseMoney)
		.filter((value) => !Number.isNaN(value));

	if (prices.length) {
		const uniquePrices = [...new Set(prices)];
		const min = Math.min(...uniquePrices);
		const max = Math.max(...uniquePrices);

		return min === max ? formatMoney(min) : `${formatMoney(min)} a ${formatMoney(max)}`;
	}

	const priceAmount = getMetaContent(html, "product:price:amount");
	const price = priceAmount ? Number(priceAmount) : null;

	return price ? formatMoney(price) : "";
}

function getBolNotes(description) {
	return cleanText(
		description
			.replace(/^comprar bilhetes para\s*/i, "")
			.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(?:às|as)\s*\d{1,2}h\d{2},?\s*/i, "")
	);
}

function getBolPageData(html, sourceUrl) {
	const ogTitle = getMetaContent(html, "og:title") || getTitleTag(html).replace(/^Bilhetes\s+/i, "");
	const metaName = getMetaContent(html, "name");
	const description = getMetaContent(html, "og:description") || getMetaContent(html, "description") || "";
	const titleParts = cleanText(ogTitle)
		.split(/\s+-\s+/)
		.map((part) => cleanText(part))
		.filter(Boolean);
	const artistName = titleParts[0] || metaName || ogTitle;
	const cityName = titleParts.length >= 3 ? titleParts[1] : "";
	const venueName = titleParts.length >= 3 ? titleParts.slice(2).join(" - ") : "";
	const date = getBolDate(description, html);

	return {
		name: metaName || [artistName, cityName].filter(Boolean).join(" - ") || ogTitle,
		artistName,
		date: date.date || null,
		time: date.time || null,
		venueName,
		cityName,
		price: getBolPriceRange(html),
		image: getMetaContent(html, "og:image"),
		notes: getBolNotes(description),
		url: sourceUrl
	};
}

async function findCityFromLocation(location) {
	const cities = await db.query("SELECT id, name FROM city");
	const normalizedLocation = normalize(location);
	const city = cities
		.filter((item) => normalizedLocation.endsWith(normalize(item.name)))
		.sort((a, b) => normalize(b.name).length - normalize(a.name).length)[0];

	if (!city) {
		return { city: null, venueName: location };
	}

	const normalizedCity = normalize(city.name);
	const locationWords = normalizedLocation.split(" ");
	const cityWords = normalizedCity.split(" ");
	const venueName = locationWords.slice(0, locationWords.length - cityWords.length).join(" ");
	const rawVenueName = location.split(/\s+/).slice(0, venueName.split(/\s+/).filter(Boolean).length).join(" ");

	return {
		city,
		venueName: cleanText(rawVenueName.replace(/[,\s]+$/g, ""))
	};
}

async function findByName(table, name) {
	if (!name) {
		return null;
	}

	if (!["artist", "venue", "city"].includes(table)) {
		return null;
	}

	const rows = await db.query(`SELECT id, name FROM ${table}`);
	const normalizedName = normalize(name);
	const nameTokens = normalizedName.split(" ").filter((token) => token.length > 1 && !["de", "da", "do", "das", "dos"].includes(token));
	const exactMatch = rows.find((row) => normalize(row.name) === normalizedName);

	if (exactMatch) {
		return exactMatch;
	}

	const tokenMatch = rows
		.map((row) => {
			const normalizedRowName = normalize(row.name);
			const rowTokens = normalizedRowName.split(" ").filter((token) => token.length > 1 && !["de", "da", "do", "das", "dos"].includes(token));
			const sharedTokens = nameTokens.filter((token) => rowTokens.includes(token)).length;

			return {
				row,
				score: sharedTokens,
				delta: Math.abs(rowTokens.length - nameTokens.length)
			};
		})
		.filter((match) => nameTokens.length && match.score === nameTokens.length)
		.sort((a, b) => a.delta - b.delta || normalize(a.row.name).length - normalize(b.row.name).length)[0];

	return tokenMatch?.row || null;
}

function buildDescription({ price, notes, description, promoter, url }) {
	const parts = [];

	if (price) {
		parts.push(`Preços: ${price}`);
	}

	if (notes) {
		parts.push(notes);
	}

	if (description) {
		parts.push(description);
	}

	if (promoter) {
		parts.push(`Promotor: ${promoter}`);
	}

	parts.push(`Fonte: ${url}`);

	return parts.join("\n\n");
}

async function withDatabaseMatches(data) {
	let city = data.cityName ? await findByName("city", data.cityName) : null;
	let venueName = data.venueName || null;

	if (!venueName && data.location) {
		const locationMatch = await findCityFromLocation(data.location);
		venueName = locationMatch.venueName;
		city = city || locationMatch.city;
	}

	const venue = await findByName("venue", venueName);
	const artistName = data.artistName || data.name;
	const artist = await findByName("artist", artistName);

	return {
		name: data.name,
		artistName,
		artist,
		date: data.date || null,
		time: data.time || null,
		venueName,
		venue,
		cityName: data.cityName || city?.name || null,
		city: city || null,
		price: data.price || null,
		image: data.image || null,
		description: buildDescription({
			price: data.price,
			notes: data.notes,
			description: data.description,
			promoter: data.promoter,
			url: data.url
		})
	};
}

async function previewFromUrl(url) {
	const sourceUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
	const parsedUrl = new URL(sourceUrl);
	const isTicketline = ["ticketline.pt", "www.ticketline.pt"].includes(parsedUrl.hostname);
	const isBol = parsedUrl.hostname === "bol.pt" || parsedUrl.hostname.endsWith(".bol.pt");

	if (!isTicketline && !isBol) {
		throw new Error("URL não suportado. Para já consigo importar links da Ticketline e da BOL.");
	}

	const response = await fetchHtml(sourceUrl);

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error("Não foi possível ler o evento.");
	}

	const html = response.body;

	if (isBol) {
		return withDatabaseMatches(getBolPageData(html, sourceUrl));
	}

	const text = stripHtml(html);
	const lines = text
		.split("\n")
		.map((line) => cleanText(line))
		.filter(Boolean);

	let name = getTitle(html, lines);
	const image = getMetaContent(html, "og:image") || getMetaContent(html, "twitter:image");
	const session = getSessionParts(getSessionLine(lines));
	const description = getDescription(lines);
	const notes = getNotes(lines);
	const promoter = getPromoter(lines);
	const sessionPageData = getSessionPageData(html, text);
	const pageSessionData = Object.keys(sessionPageData).length ? sessionPageData : getEventPageData(html);

	if (pageSessionData.name) {
		name = pageSessionData.name;
	}

	if (pageSessionData.day) {
		session.day = pageSessionData.day;
	}

	if (pageSessionData.month) {
		session.month = pageSessionData.month;
	}

	if (pageSessionData.year) {
		session.year = pageSessionData.year;
	}

	if (pageSessionData.time) {
		session.time = pageSessionData.time;
	}

	if (pageSessionData.location) {
		session.location = pageSessionData.location;
	}

	if (pageSessionData.price) {
		session.price = pageSessionData.price;
	}

	const year = session.year || (session.day && session.month ? getYear(description || text, session.day, session.month) : null);
	const date = formatDate(session.day, session.month, year);
	return withDatabaseMatches({
		name,
		artistName: name,
		date,
		time: session.time || null,
		venueName: pageSessionData.cityName ? session.location : null,
		location: session.location,
		cityName: pageSessionData.cityName || null,
		price: session.price || null,
		image,
		notes,
		description,
		promoter,
		url: sourceUrl
	});
}

module.exports = {
	previewFromUrl
};
