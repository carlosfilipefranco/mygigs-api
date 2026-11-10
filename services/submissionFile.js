const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { TextDecoder } = require("util");

// O volume existente guarda os uploads. Esta pasta é privada e bloqueada no servidor HTTP.
const root = path.join(__dirname, "../public/uploads/.submissions");
const maxBytes = 5 * 1024 * 1024;
const extensions = new Set([".csv", ".tsv", ".txt", ".xls", ".xlsx", ".ods", ".pdf"]);

function fail(message) {
	throw Object.assign(new Error(message), { statusCode: 400 });
}

async function store(input) {
	if (typeof input?.name !== "string" || typeof input?.content !== "string") fail("Escolhe um ficheiro com a listagem de concertos.");
	const name = input.name.replace(/\\/g, "/").split("/").pop().replace(/[\x00-\x1f\x7f]/g, "").trim();
	const extension = path.extname(name).toLowerCase();
	if (!name || name.length > 200 || !extensions.has(extension)) fail("Usa um ficheiro CSV, TSV, TXT, XLS, XLSX, ODS ou PDF.");
	if (!input.content || input.content.length > Math.ceil(maxBytes / 3) * 4) fail("Escolhe um ficheiro até 5 MB.");
	if (input.content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) fail("Ficheiro inválido.");
	const buffer = Buffer.from(input.content, "base64");
	if (!buffer.length || buffer.length > maxBytes) fail("Escolhe um ficheiro até 5 MB.");
	if (buffer.toString("base64") !== input.content) fail("Ficheiro inválido.");
	const header = buffer.subarray(0, 8).toString("hex");
	if (extension === ".pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail("O conteúdo não corresponde a um PDF.");
	if (extension === ".xls" && header !== "d0cf11e0a1b11ae1") fail("O conteúdo não corresponde a um ficheiro XLS.");
	if ([".xlsx", ".ods"].includes(extension) && !header.startsWith("504b0304")) fail("O conteúdo não corresponde a uma folha de cálculo.");
	if ([".csv", ".tsv", ".txt"].includes(extension)) {
		try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
		catch { fail("Guarda o ficheiro de texto em UTF-8 antes de o enviares."); }
		if (buffer.includes(0)) fail("Ficheiro de texto inválido.");
	}
	const key = randomUUID() + extension;
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	await fs.writeFile(path.join(root, key), buffer, { flag: "wx", mode: 0o600 });
	return { key, name, size: buffer.length };
}

function filePath(key) {
	if (typeof key !== "string" || !/^[a-f0-9-]{36}\.(csv|tsv|txt|xls|xlsx|ods|pdf)$/.test(key)) fail("Ficheiro inválido.");
	return path.join(root, key);
}

async function remove(key) {
	await fs.unlink(filePath(key));
}

module.exports = { store, filePath, remove };
