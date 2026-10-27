const { serviceKey } = require("./securityConfig");
const fetch = require("node-fetch");

const maxImageBytes = 10 * 1024 * 1024;
let activeUploads = 0;

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }

function validateImage(value) {
	if (typeof value !== "string" || value.length > Math.ceil(maxImageBytes / 3) * 4 + 100) fail(400, "Escolhe uma imagem até 10 MB.");
	const base64 = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
	if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail(400, "Imagem inválida.");
	const buffer = Buffer.from(base64, "base64");
	if (buffer.toString("base64") !== base64) fail(400, "Imagem inválida.");
	if (!buffer.length || buffer.length > maxImageBytes) fail(400, "Escolhe uma imagem até 10 MB.");
	const header = buffer.subarray(0, 32);
	const hex = header.toString("hex");
	const ascii = header.toString("ascii");
	const raster = hex.startsWith("ffd8ff") || hex.startsWith("89504e470d0a1a0a") || /^GIF8[79]a/.test(ascii)
		|| (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") || ascii.startsWith("BM")
		|| hex.startsWith("49492a00") || hex.startsWith("4d4d002a")
		|| (ascii.slice(4, 8) === "ftyp" && /^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii.slice(8, 12)));
	if (!raster) fail(400, "Formato de imagem não suportado. Usa uma fotografia JPEG, PNG, WebP, GIF, HEIC ou AVIF.");
	return base64;
}

async function upload(image) {
	const base64 = validateImage(image);
	const apiKey = serviceKey("IMGBB_API_KEY");
	if (!apiKey) fail(503, "O envio de fotografias não está configurado.");
	if (activeUploads >= 4) fail(429, "Há vários uploads em curso. Tenta novamente dentro de momentos.");
	activeUploads++;
	try {
		const response = await fetch("https://api.imgbb.com/1/upload", {
			method: "POST", body: new URLSearchParams({ key: apiKey, image: base64 }),
			timeout: 30000, size: 64 * 1024, redirect: "error"
		});
		if (!response.ok) fail(502, "Não foi possível enviar a fotografia.");
		const data = await response.json();
		let url;
		try { url = new URL(data?.data?.url); } catch { fail(502, "Resposta inválida do serviço de fotografias."); }
		if (url.protocol !== "https:" || url.username || url.password) fail(502, "Resposta inválida do serviço de fotografias.");
		return { url: url.href };
	} catch (error) {
		if (error.statusCode) throw error;
		fail(502, "Não foi possível enviar a fotografia.");
	} finally { activeUploads--; }
}

module.exports = { upload };
