const { serviceKey } = require("./securityConfig");
const fetch = require("node-fetch");
const db = require("./db");
const fs = require("fs");
const path = require("path");
const { normalizeCityName, normalizeCityState } = require("./city");
const { isFestivalVenueName } = require("./venueNames");

const { getSetlist, fetchSetlist } = require("./concertSetlist");
function apiKey() {
	return serviceKey("SETLISTFM_API_KEY");
}
const OUTPUT_FILE = "./setlists_pt.json";

function normalizeEncore(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function importSetlists(req, res) {
	try {
		const rawData = fs.readFileSync(path.join(__dirname, "../setlists.json"), "utf8");
		const data = JSON.parse(rawData);

		for (const item of data) {
			const gigId = parseInt(item.gigId);
			const setlist = item.setlist;

			console.log(`\n🎵 A processar gig ID ${gigId} (${item.artist} - ${item.city} - ${item.date})`);

			if (!setlist || !setlist.sets || !Array.isArray(setlist.sets.set)) {
				console.warn(`⚠️ Setlist inválida ou nula para gig ${gigId}. Ignorado.`);
				continue;
			}

			const existingResult = await db.query(`SELECT id FROM setlist WHERE gig_id = ? LIMIT 1`, [gigId]);
			if (Array.isArray(existingResult) && existingResult.length > 0) {
				console.log(`✅ Setlist já existe para gig ${gigId}. Ignorado.`);
				continue;
			}

			const gigResult = await db.query(`SELECT artist_id FROM gig WHERE id = ? LIMIT 1`, [gigId]);
			if (!Array.isArray(gigResult) || gigResult.length === 0) {
				console.warn(`❌ Gig ${gigId} não encontrado — verifique se está na BD.`);
				continue;
			}
			const artistId = gigResult[0].artist_id;

			const insertSetlistResult = await db.query(`INSERT INTO setlist (gig_id, artist_id) VALUES (?, ?)`, [gigId, artistId]);
			const setlistId = insertSetlistResult.insertId;
			if (!setlistId) {
				console.warn(`❌ Não foi possível inserir setlist para gig ${gigId}`);
				continue;
			}
			console.log(`🆕 Setlist criada com ID ${setlistId} para gig ${gigId}`);

			let position = 1;
			let songCount = 0;

			for (const set of setlist.sets.set) {
				const encore = normalizeEncore(set.encore);
				for (const song of set.song || []) {
					const songName = song.name?.trim();
					if (!songName) continue;

					await db.query(`INSERT IGNORE INTO song (name, artist_id) VALUES (?, ?)`, [songName, artistId]);

					const songRows = await db.query(`SELECT id FROM song WHERE name = ? AND artist_id = ? LIMIT 1`, [songName, artistId]);
					if (!Array.isArray(songRows) || songRows.length === 0) {
						console.warn(`⚠️ Música '${songName}' não encontrada na BD após inserção`);
						continue;
					}

					const songId = songRows[0].id;
					if (!songId) continue;

					await db.query(`INSERT INTO setlist_song (setlist_id, song_id, position, encore) VALUES (?, ?, ?, ?)`, [setlistId, songId, position, encore]);

					position++;
					songCount++;
				}
			}

			console.log(`🎤 Gig ${gigId} com artista ${artistId} concluído. ${songCount} músicas adicionadas.`);
		}

		res.json({ success: true, message: "Setlists importadas com sucesso." });
	} catch (error) {
		console.error("💥 Erro ao importar setlists:", error);
		res.status(500).json({ success: false, error: "Erro ao importar setlists." });
	}
}

async function fetchPage(page) {
	const url = `https://api.setlist.fm/rest/1.0/search/venues?country=PT&p=${page}`;

	const res = await fetch(url, {
		headers: {
			Accept: "application/json",
			"x-api-key": apiKey(),
			"User-Agent": "mygigs-app/1.0"
		}
	});

	if (res.status === 429) {
		console.log("⏳ Rate limit atingido. A aguardar 2 segundos...");
		await new Promise((r) => setTimeout(r, 2000));
		return fetchPage(page);
	}

	if (!res.ok) {
		const t = await res.text();
		throw new Error(`Erro: ${res.status} - ${t}`);
	}

	return res.json();
}

async function fetchAllPortugalVenues() {
	let page = 1;
	let totalPages = null;

	console.log("🔎 A recolher venues em Portugal…");

	// Inicializar ficheiro vazio
	fs.writeFileSync(OUTPUT_FILE, "[");

	while (true) {
		console.log(`➡️ Página ${page}`);

		const data = await fetchPage(page);

		if (!totalPages) {
			totalPages = data.totalPages;
			console.log(`📄 Total de páginas: ${totalPages}`);
		}

		if (!data.venue || data.venue.length === 0) break;

		// Adicionar vírgula entre páginas, exceto na primeira
		if (page > 1) fs.appendFileSync(OUTPUT_FILE, ",");

		// Escrever como JSON
		fs.appendFileSync(OUTPUT_FILE, JSON.stringify(data.venue, null, 2).slice(1, -1));

		if (page >= totalPages) break;
		page++;

		await new Promise((r) => setTimeout(r, 1100));
	}

	fs.appendFileSync(OUTPUT_FILE, "]");
	console.log("🎉 Finalizado! Guardado em:", OUTPUT_FILE);
}

async function importCities() {
	try {
		// 1. Ler ficheiro
		const raw = fs.readFileSync(OUTPUT_FILE, "utf8");
		const venues = JSON.parse(raw);

		// 2. Usar map para criar chave única cityName -> state
		const cityMap = new Map();

		for (const venue of venues) {
			if (!venue.city) continue;

			const name = normalizeCityName(venue.city.name, venue.city.country?.code);
			const state = normalizeCityState(venue.city.state, venue.city.country?.code);

			if (!name) continue;

			if (!cityMap.has(name)) {
				cityMap.set(name, state);
			}
		}

		console.log(`📍 Encontradas ${cityMap.size} cidades únicas.`);

		// 3. Inserir/Atualizar BD
		for (const [name, state] of cityMap) {
			// Verificar se já existe
			const existing = await db.query("SELECT id FROM city WHERE name = ? LIMIT 1", [name]);

			if (existing.length > 0) {
				// Atualizar state
				await db.query("UPDATE city SET state = ? WHERE id = ?", [state, existing[0].id]);
				console.log(`🔄 Atualizada cidade: ${name} (${state})`);
			} else {
				// Inserir nova
				await db.query("INSERT INTO city (name, state) VALUES (?, ?)", [name, state]);
				console.log(`🆕 Inserida cidade: ${name} (${state})`);
			}
		}

		console.log("🎉 Importação concluída!");
		return { success: true };
	} catch (err) {
		console.error("💥 Erro ao importar cidades:", err);
		return { success: false, error: err.message };
	}
}

async function importVenues() {
	try {
		const raw = fs.readFileSync(OUTPUT_FILE, "utf8");
		const venues = JSON.parse(raw);

		let totalInserted = 0;
		let totalUpdated = 0;

		for (const venue of venues) {
			const name = venue.name?.trim();
			if (!name) continue; // ignorar venues sem nome
			if (isFestivalVenueName(name)) continue;

			const cityName = normalizeCityName(venue.city?.name, venue.city?.country?.code);
			if (!cityName) continue;

			const state = venue.city?.state?.trim() || null;

			const lat = venue.city?.coords?.lat || null;
			const lng = venue.city?.coords?.long || null;

			// 1. Obter city_id
			const cityRow = await db.query("SELECT id FROM city WHERE name = ? LIMIT 1", [cityName]);

			if (cityRow.length === 0) {
				console.warn(`⚠ Cidade '${cityName}' não existe na BD. Ignorar venue '${name}'.`);
				continue;
			}

			const cityId = cityRow[0].id;

			// 2. Verificar duplicado (name + city_id + coords)
			const existing = await db.query(
				`SELECT id FROM venue 
				 WHERE name = ? 
				   AND city_id = ?
				   AND (lat = ? OR lat IS NULL AND ? IS NULL)
				   AND (lng = ? OR lng IS NULL AND ? IS NULL)
				 LIMIT 1`,
				[name, cityId, lat, lat, lng, lng]
			);

			if (existing.length > 0) {
				// Atualizar lat/lng se necessário (por segurança)
				await db.query(`UPDATE venue SET lat = ?, lng = ? WHERE id = ?`, [lat, lng, existing[0].id]);
				totalUpdated++;
				continue;
			}

			// 3. Inserir venue novo
			try {
				await db.query(`INSERT INTO venue (name, city_id, lat, lng) VALUES (?, ?, ?, ?)`, [name, cityId, lat, lng]);

				console.log(`🆕 Inserido venue: ${name} (${cityName})`);
			} catch (err) {
				if (err.code === "ER_DUP_ENTRY") {
					console.log(`⚠️ Venue duplicado ignorado: ${name} (${cityName})`);
					continue;
				}
				console.error(`💥 Erro inesperado ao inserir venue (${name}):`, err);
				continue;
			}

			totalInserted++;
		}

		console.log(`\n🎉 VENUES IMPORTADOS`);
		console.log(`   ➝ Inseridos: ${totalInserted}`);
		console.log(`   ➝ Atualizados: ${totalUpdated}`);

		return { success: true };
	} catch (err) {
		console.error("💥 Erro ao importar venues:", err);
		return { success: false, error: err.message };
	}
}

function mergeDuplicateVenues(req, res) {
	// O mesmo nome pode identificar espaços diferentes em cidades diferentes.
	// As associações confirmadas usam a gestão de locais, que exige a mesma cidade.
	return res.status(409).json({ message: "A associação automática de locais apenas pelo nome foi desativada. Usa a gestão de locais para associar fichas confirmadas do mesmo espaço e da mesma cidade." });
}

module.exports = {
	getSetlist,
	fetchSetlist,
	importSetlists,
	fetchAllPortugalVenues,
	importCities,
	importVenues,
	mergeDuplicateVenues
};
