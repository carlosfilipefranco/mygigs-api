const fetch = require("node-fetch");
const db = require("./db");
const fs = require("fs");
const path = require("path");

const API_KEY = "33b04241-2c2f-45e6-959a-ddf01429fc76";
const OUTPUT_FILE = "./setlists_pt.json";

function normalizeEncore(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function getSetlist(gigId, artist, city, date) {
	if (!artist || !city || !date || !gigId) {
		throw new Error("Parâmetros obrigatórios em falta: gigId, artist, city, date");
	}

	const url = new URL("https://api.setlist.fm/rest/1.0/search/setlists");
	url.searchParams.append("artistName", artist);
	url.searchParams.append("cityName", city);
	url.searchParams.append("date", date);

	const response = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"x-api-key": API_KEY,
			"User-Agent": "concert-app/1.0"
		}
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Erro na API setlist.fm: ${response.status} - ${text}`);
	}

	const data = await response.json();
	const found = data.setlist?.[0];

	if (!found || !found.sets || !Array.isArray(found.sets.set)) {
		return null; // Nada para gravar
	}

	// Verificar se já existe
	const existing = await db.query(`SELECT id FROM setlist WHERE gig_id = ?`, [gigId]);
	if (existing.length > 0) {
		return null; // Já existe, não gravar
	}

	// Obter artist_id da tabela gig
	const gigResult = await db.query(`SELECT artist_id FROM gig WHERE id = ? LIMIT 1`, [gigId]);
	if (!Array.isArray(gigResult) || gigResult.length === 0) {
		throw new Error(`Gig com ID ${gigId} não encontrado na base de dados.`);
	}
	const artistId = gigResult[0].artist_id;

	// Criar nova setlist
	const setlistResult = await db.query(`INSERT INTO setlist (gig_id, artist_id) VALUES (?, ?)`, [gigId, artistId]);
	console.log(setlistResult);
	const setlistId = setlistResult.insertId;

	let position = 1;
	let songCount = 0;

	console.log(found);

	for (const set of found.sets.set) {
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

	let message = "finished";

	return { message };
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
			"x-api-key": API_KEY,
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

			const name = venue.city.name?.trim();
			const state = venue.city.state?.trim() || null;

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

			const cityName = venue.city?.name?.trim();
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

async function mergeDuplicateVenues() {
	try {
		// Seleciona apenas os venues originais sem city/coords
		const originals = await db.query(`
  SELECT * FROM venue 
  WHERE city_id IS NULL AND lat IS NULL AND lng IS NULL
`);

		for (const dup of originals) {
			const name = dup.name;
			console.log(`\n🔹 Processando venue duplicado: ${name}`);

			// 2) Obter todas as venues com este nome
			const venues = await db.query(`SELECT * FROM venue WHERE name = ? ORDER BY id ASC`, [name]);

			// Presumimos que a primeira é a "mãe" (a que queremos manter)
			const master = venues[0];
			const replicas = venues.slice(1);

			for (const rep of replicas) {
				// 3) Atualizar dados na mãe se estiverem vazios
				const updateFields = {};
				if (!master.city_id && rep.city_id) updateFields.city_id = rep.city_id;
				if (!master.lat && rep.lat) updateFields.lat = rep.lat;
				if (!master.lng && rep.lng) updateFields.lng = rep.lng;

				if (Object.keys(updateFields).length > 0) {
					const setClause = Object.keys(updateFields)
						.map((f) => `${f} = ?`)
						.join(", ");
					const values = Object.values(updateFields).concat(master.id);
					await db.query(`UPDATE venue SET ${setClause} WHERE id = ?`, values);
					console.log(`  ✏️ Atualizada venue mãe ID ${master.id} com dados da réplica ID ${rep.id}`);
				}

				// 4) Atualizar todos os gigs que apontam para a réplica
				await db.query(`UPDATE gig SET venue_id = ? WHERE venue_id = ?`, [master.id, rep.id]);
				console.log(`  🔄 Gigs da réplica ID ${rep.id} apontados para mãe ID ${master.id}`);

				// 5) Apagar a réplica
				await db.query(`DELETE FROM venue WHERE id = ?`, [rep.id]);
				console.log(`  🗑 Apagada réplica ID ${rep.id}`);
			}
		}

		console.log("\n✅ Merge concluído!");
	} catch (err) {
		console.error("💥 Erro ao fazer merge das venues:", err);
	}
}

module.exports = {
	getSetlist,
	importSetlists,
	fetchAllPortugalVenues,
	importCities,
	importVenues,
	mergeDuplicateVenues
};
