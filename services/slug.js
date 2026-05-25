function slugify(value) {
	const normalized = (value || "")
		.toString()
		.trim()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");

	return normalized || "";
}

function extractNumericId(identifier) {
	if (identifier === null || typeof identifier === "undefined") {
		return null;
	}

	const raw = `${identifier}`.trim();
	if (!raw) {
		return null;
	}

	if (/^\d+$/.test(raw)) {
		const parsed = Number(raw);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	const match = raw.match(/^(\d+)(?:-|$)/);
	if (!match) {
		return null;
	}

	const parsed = Number(match[1]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeTableName(tableName) {
	if (!/^[a-z_]+$/i.test(tableName || "")) {
		throw new Error("Invalid table name for slug resolution");
	}

	return tableName;
}

async function resolveEntityIdByIdentifier(db, tableName, identifier, slugColumn = "slug") {
	const table = sanitizeTableName(tableName);

	const numericId = extractNumericId(identifier);
	if (numericId) {
		return numericId;
	}

	const slug = slugify(identifier);
	if (!slug) {
		return null;
	}

	const rows = await db.query(`SELECT id FROM ${table} WHERE ${slugColumn} = ? LIMIT 1`, [slug]);
	if (!rows.length) {
		return null;
	}

	const resolvedId = Number(rows[0].id);
	return Number.isFinite(resolvedId) && resolvedId > 0 ? resolvedId : null;
}

async function buildUniqueSlug(db, tableName, sourceValue, currentId = null, slugColumn = "slug") {
	const table = sanitizeTableName(tableName);
	const baseSlug = slugify(sourceValue) || "item";

	const existingRows = await db.query(`SELECT id, ${slugColumn} AS slug FROM ${table} WHERE ${slugColumn} = ? OR ${slugColumn} LIKE ?`, [baseSlug, `${baseSlug}-%`]);
	const existingSlugs = new Set(
		(existingRows || [])
			.filter((row) => !currentId || Number(row.id) !== Number(currentId))
			.map((row) => `${row.slug || ""}`.trim())
			.filter(Boolean)
	);

	if (!existingSlugs.has(baseSlug)) {
		return baseSlug;
	}

	let suffix = 2;
	let candidate = `${baseSlug}-${suffix}`;
	while (existingSlugs.has(candidate)) {
		suffix += 1;
		candidate = `${baseSlug}-${suffix}`;
	}

	return candidate;
}

module.exports = {
	slugify,
	extractNumericId,
	resolveEntityIdByIdentifier,
	buildUniqueSlug
};
