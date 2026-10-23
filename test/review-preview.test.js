const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Response } = require("node-fetch");
const { Readable } = require("node:stream");
const { createPreviewService, extractPreview, normalizeUrl } = require("../services/reviewPreview");

const html = `<html><head>
	<title>Fallback title</title>
	<meta content="Radiohead: uma noite de &quot;arrepiar&quot;" property="og:title">
	<meta name="description" content="Fallback description">
	<meta property='og:description' content="O público cantou 'Creep' &amp; pediu mais.">
	<meta property="og:image" content="/images/live.jpg?width=800&amp;height=400">
	<meta property="og:site_name" content="Revista de Música">
</head><body><script>alert('ignored')</script></body></html>`;
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const htmlResponse = (body = html) => new Response(Readable.from([Buffer.from(body)]), { headers: { "Content-Type": "text/html; charset=utf-8" } });

test("extracts Open Graph title, description, source and relative image", () => {
	assert.deepEqual(extractPreview(html, "https://example.com/review"), {
		url: "https://example.com/review",
		title: 'Radiohead: uma noite de "arrepiar"',
		description: "O público cantou 'Creep' & pediu mais.",
		image: "https://example.com/images/live.jpg?width=800&height=400",
		site_name: "Revista de Música",
		available: true
	});
});

test("supports Twitter cards and falls back to HTML title and article text", () => {
	const twitter = extractPreview('<meta name="twitter:title" content="Concerto"><meta name="twitter:description" content="Crítica">', "https://example.com");
	assert.equal(twitter.title, "Concerto");
	assert.equal(twitter.description, "Crítica");
	const plain = extractPreview('<title>Live review</title><nav><p>Ignore navigation</p></nav><article><p>Uma noite memorável com um alinhamento que conquistou todo o público presente.</p></article>', "https://example.com");
	assert.equal(plain.title, "Live review");
	assert.match(plain.description, /^Uma noite memorável/);
});

test("does not expose HTML markup or unsafe preview images", () => {
	const preview = extractPreview('<meta property="og:title" content="&lt;b&gt;Concerto&lt;/b&gt;"><meta property="og:image" content="javascript:alert(1)">', "https://example.com");
	assert.equal(preview.title, "Concerto");
	assert.equal(preview.image, null);
});

test("rejects local addresses, encoded loopback, credentials and non-HTTP URLs", () => {
	for (const url of ["file:///etc/passwd", "ftp://example.com", "http://localhost", "http://a.local", "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "http://[::ffff:127.0.0.1]", "https://user:password@example.com", "https://example.com:8080"]) {
		assert.throws(() => normalizeUrl(url), url);
	}
});

test("pins the HTTP connection to the validated public DNS address", async () => {
	const service = createPreviewService({ lookup: publicLookup, fetchPage: async (url, options) => {
		assert.equal(url, "https://example.com/review");
		assert.equal(options.redirect, "manual");
		options.agent.options.lookup("example.com", {}, (error, address, family) => {
			assert.equal(error, null);
			assert.equal(address, "93.184.216.34");
			assert.equal(family, 4);
		});
		return htmlResponse();
	} });
	assert.equal((await service.getPreview("https://example.com/review")).available, true);
});

test("blocks private DNS results, including mixed and IPv4-mapped results", async () => {
	for (const addresses of [["127.0.0.1"], ["93.184.216.34", "10.0.0.1"], ["::ffff:192.168.0.1"], ["fc00::1"]]) {
		const service = createPreviewService({
			lookup: async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
			fetchPage: async () => assert.fail("Must not fetch a private destination")
		});
		assert.equal((await service.getPreview("https://example.com/review")).available, false);
	}
});

test("follows public redirects and resolves relative metadata against the final URL", async () => {
	let calls = 0;
	const service = createPreviewService({ lookup: publicLookup, fetchPage: async () => ++calls === 1
		? new Response(null, { status: 302, headers: { location: "https://reviews.example.org/live/article" } })
		: htmlResponse('<title>Review</title><meta property="og:image" content="../photo.jpg">') });
	const preview = await service.getPreview("https://example.com/review");
	assert.equal(calls, 2);
	assert.equal(preview.url, "https://reviews.example.org/live/article");
	assert.equal(preview.image, "https://reviews.example.org/photo.jpg");
});

test("checks redirects again and never follows a redirect to a private address", async () => {
	let calls = 0;
	const service = createPreviewService({ lookup: publicLookup, fetchPage: async () => {
		calls++;
		return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/secret" } });
	} });
	const preview = await service.getPreview("https://example.com/review");
	assert.equal(calls, 1);
	assert.equal(preview.available, false);
	assert.equal(preview.url, "https://example.com/review");
});

test("deduplicates concurrent previews and caches successful results", async () => {
	let calls = 0;
	const service = createPreviewService({ lookup: publicLookup, fetchPage: async () => { calls++; return htmlResponse(); } });
	const previews = await Promise.all([service.getPreview("https://example.com/review"), service.getPreview("https://example.com/review#section")]);
	assert.deepEqual(previews[0], previews[1]);
	assert.equal(previews[0].available, true);
	await service.getPreview("https://example.com/review");
	assert.equal(calls, 1);
});

test("retries unavailable previews after the failure cache expires", async () => {
	let timestamp = 0, calls = 0;
	const service = createPreviewService({ now: () => timestamp, lookup: publicLookup, fetchPage: async () => {
		calls++;
		return calls === 1 ? new Response(null, { status: 403 }) : htmlResponse();
	} });
	assert.equal((await service.getPreview("https://example.com/review")).available, false);
	timestamp += 6 * 60 * 1000;
	assert.equal((await service.getPreview("https://example.com/review")).available, true);
	assert.equal(calls, 2);
});

test("keeps a usable link on HTTP errors and non-HTML responses", async () => {
	for (const response of [new Response(null, { status: 403 }), new Response('{}', { headers: { "content-type": "application/json" } })]) {
		const service = createPreviewService({ lookup: publicLookup, fetchPage: async () => response });
		const preview = await service.getPreview("https://example.com/review");
		assert.equal(preview.url, "https://example.com/review");
		assert.equal(preview.available, false);
	}
});

test("limits downloaded HTML and decodes legacy character sets", async () => {
	const service = createPreviewService({ maxBytes: 200, lookup: publicLookup, fetchPage: async () =>
		new Response(Readable.from([Buffer.from('<title>Música ao vivo</title>' + 'x'.repeat(1000), "latin1")]), { headers: { "content-type": "text/html; charset=iso-8859-1" } }) });
	assert.equal((await service.getPreview("https://example.com/review")).title, "Música ao vivo");
});

test("returns a fallback within the deadline even if DNS does not finish", async () => {
	const service = createPreviewService({ timeoutMs: 20, lookup: () => new Promise(() => {}), fetchPage: async () => assert.fail("No DNS result") });
	assert.equal((await service.getPreview("https://example.com/review")).available, false);
});
