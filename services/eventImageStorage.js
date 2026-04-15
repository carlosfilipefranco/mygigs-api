const fs = require("fs/promises");
const path = require("path");
const fetch = require("node-fetch");

const uploadRoot = path.join(__dirname, "../public/uploads/events");
const publicUploadPath = "/uploads/events";

function slugify(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.substring(0, 80);
}

function getLocalImagePath(url) {
	if (!url) {
		return null;
	}

	if (url.startsWith(`${publicUploadPath}/`)) {
		return url;
	}

	try {
		const pathname = new URL(url).pathname;
		if (pathname.startsWith(`${publicUploadPath}/`)) {
			return pathname;
		}
	} catch (error) {
		return null;
	}

	return null;
}

function getExistingRelativeImagePath(image) {
	const localImagePath = getLocalImagePath(image);
	if (!localImagePath) {
		return null;
	}

	const filename = path.basename(localImagePath);
	return `${publicUploadPath}/${filename}`;
}

function isRemoteImage(url) {
	try {
		const protocol = new URL(url).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch (error) {
		return false;
	}
}

function getExtension(contentType, url) {
	const contentTypeMap = {
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif"
	};

	if (contentTypeMap[contentType]) {
		return contentTypeMap[contentType];
	}

	try {
		const pathname = new URL(url).pathname;
		const extension = path.extname(pathname).replace(".", "").toLowerCase();
		if (["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
			return extension === "jpeg" ? "jpg" : extension;
		}
	} catch (error) {
		return "jpg";
	}

	return "jpg";
}

async function removeExistingEventImages(eventId, exceptPath = null) {
	try {
		const files = await fs.readdir(uploadRoot);
		await Promise.all(
			files
				.filter((file) => file.startsWith(`${eventId}-`))
				.map((file) => path.join(uploadRoot, file))
				.filter((filePath) => filePath !== exceptPath)
				.map((filePath) => fs.unlink(filePath).catch(() => null))
		);
	} catch (error) {
		if (error.code !== "ENOENT") {
			throw error;
		}
	}
}

async function downloadEventImage({ id, name, image, replaceExisting = false, overwrite = false }) {
	const response = await fetch(image, {
		headers: {
			"User-Agent": "Mozilla/5.0 MyGigs image downloader"
		},
		redirect: "follow",
		timeout: 30000
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
	if (contentType && !contentType.startsWith("image/")) {
		throw new Error(`invalid content-type: ${contentType}`);
	}

	await fs.mkdir(uploadRoot, { recursive: true });

	const extension = getExtension(contentType, image);
	const filename = `${id}-${slugify(name) || "event"}.${extension}`;
	const filePath = path.join(uploadRoot, filename);
	const publicUrl = `${publicUploadPath}/${filename}`;

	if (!replaceExisting && !overwrite) {
		try {
			await fs.access(filePath);
			return { image: publicUrl, skippedExistingFile: true };
		} catch (error) {
			// File does not exist yet.
		}
	}

	const buffer = await response.buffer();
	const tempPath = `${filePath}.tmp-${Date.now()}`;
	await fs.writeFile(tempPath, buffer);

	if (replaceExisting || overwrite) {
		await removeExistingEventImages(id, tempPath);
	}

	await fs.rename(tempPath, filePath);

	return { image: publicUrl, size: buffer.length };
}

async function storeEventImage({ id, name, image, replaceExisting = false, overwrite = false }) {
	if (!image || image === "null") {
		return { image: null };
	}

	const localImagePath = getExistingRelativeImagePath(image);
	if (localImagePath) {
		return { image: localImagePath, normalized: localImagePath !== image };
	}

	if (!isRemoteImage(image)) {
		return { image, unsupported: true };
	}

	return downloadEventImage({ id, name, image, replaceExisting, overwrite });
}

module.exports = {
	getExistingRelativeImagePath,
	isRemoteImage,
	publicUploadPath,
	storeEventImage,
	uploadRoot
};
