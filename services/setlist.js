const fetch = require("node-fetch");
const db = require("./db");
const fs = require("fs");
const path = require("path");

const API_KEY = "33b04241-2c2f-45e6-959a-ddf01429fc76";

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

			await db.query(`INSERT INTO setlist_song (setlist_id, song_id, position) VALUES (?, ?, ?)`, [setlistId, songId, position]);

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

					await db.query(`INSERT INTO setlist_song (setlist_id, song_id, position) VALUES (?, ?, ?)`, [setlistId, songId, position]);

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

module.exports = {
	getSetlist,
	importSetlists
};
