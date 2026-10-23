const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const { isIP } = require("node:net");
const fetch = require("node-fetch");
const ipaddr = require("ipaddr.js");
const { load } = require("cheerio/slim");

function isPublicAddress(address) {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}

function normalizeUrl(value, base) {
	const url = new URL(value, base);
	const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
		throw new Error("Invalid review URL");
	}
	if ((!hostname.includes(".") && !isIP(hostname)) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname) || (isIP(hostname) && !isPublicAddress(hostname))) {
		throw new Error("Non-public review URL");
	}
	url.hash = "";
	return url;
}

function cleanText(value, length) {
	return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, length);
}

function fallbackPreview(url) {
	let normalized;
	try {
		normalized = normalizeUrl(url);
	} catch {
		return { url: null, title: "Review", description: null, image: null, site_name: null, available: false };
	}
	const siteName = normalized.hostname.replace(/^www\./, "");
	return { url: normalized.href, title: siteName, description: null, image: null, site_name: siteName, available: false };
}

function extractPreview(html, url) {
	const fallback = fallbackPreview(url);
	const $ = load(html);
	$("script, style, noscript, nav, header, footer").remove();
	const meta = (key) => $("meta").toArray().find((element) => ($(element).attr("property") || $(element).attr("name") || "").toLowerCase() === key);
	const content = (key) => $(meta(key)).attr("content") || "";
	const title = cleanText(content("og:title") || content("twitter:title") || $("title").first().text() || $("h1").first().text(), 250);
	const paragraph = $("article p, main p").toArray().map((element) => $(element).text()).find((text) => text.trim().length > 40);
	const description = cleanText(content("og:description") || content("twitter:description") || content("description") || paragraph, 400);
	let image = null;
	try {
		const source = content("og:image:secure_url") || content("og:image") || content("twitter:image");
		if (source) image = normalizeUrl(source, url).href;
	} catch {
		// Uma imagem inválida não impede a apresentação do texto e do link.
	}
	return {
		...fallback,
		title: title || fallback.title,
		description: description || null,
		image,
		site_name: cleanText(content("og:site_name"), 100) || fallback.site_name,
		available: Boolean(title || description || image)
	};
}

function createPreviewService({ fetchPage = fetch, lookup = dns.lookup, now = Date.now, timeoutMs = 8000, maxBytes = 512 * 1024 } = {}) {
	const cache = new Map();

	async function fetchPreview(source, signal) {
		let url = normalizeUrl(source);
		for (let redirects = 0; redirects <= 4; redirects++) {
			const hostname = url.hostname.replace(/^\[|\]$/g, "");
			const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
			if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Non-public review address");
			if (signal.aborted) throw new Error("Review preview timed out");
			const address = addresses.find((entry) => entry.family === 4) || addresses[0];
			const Agent = url.protocol === "https:" ? https.Agent : http.Agent;
			const agent = new Agent({
				lookup: (host, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family)
			});
			try {
				const response = await fetchPage(url.href, {
					agent,
					signal,
					redirect: "manual",
					headers: { "User-Agent": "Mozilla/5.0 (compatible; MyGigs review preview)", Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" }
				});
				if ([301, 302, 303, 307, 308].includes(response.status)) {
					response.body?.destroy();
					const location = response.headers.get("location");
					if (!location || redirects === 4) throw new Error("Invalid review redirect");
					url = normalizeUrl(location, url);
					continue;
				}
				const contentType = response.headers.get("content-type") || "";
				if (!response.ok || contentType && !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
					response.body?.destroy();
					throw new Error("Review HTML unavailable");
				}
				const chunks = [];
				let size = 0;
				for await (const chunk of response.body) {
					const buffer = Buffer.from(chunk);
					chunks.push(buffer.subarray(0, maxBytes - size));
					size += buffer.length;
					if (size >= maxBytes) break;
				}
				const buffer = Buffer.concat(chunks);
				const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] || buffer.subarray(0, 4096).toString("ascii").match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8";
				let html;
				try {
					html = new TextDecoder(charset).decode(buffer);
				} catch {
					html = buffer.toString("utf8");
				}
				return extractPreview(html, url.href);
			} finally {
				agent.destroy();
			}
		}
	}

	async function getPreview(source) {
		const fallback = fallbackPreview(source);
		if (!fallback.url) return fallback;
		const existing = cache.get(fallback.url);
		if (existing && existing.expires > now()) return existing.promise;
		const controller = new AbortController();
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => { controller.abort(); resolve(fallback); }, timeoutMs);
		});
		const entry = { expires: Infinity };
		entry.promise = Promise.race([fetchPreview(fallback.url, controller.signal).catch(() => fallback), timeout]).then((preview) => {
			clearTimeout(timer);
			entry.expires = now() + (preview.available ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000);
			return preview;
		});
		cache.delete(fallback.url);
		if (cache.size >= 500) cache.delete(cache.keys().next().value);
		cache.set(fallback.url, entry);
		return entry.promise;
	}

	return { getPreview };
}

module.exports = { ...createPreviewService(), createPreviewService, extractPreview, normalizeUrl };
