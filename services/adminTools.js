const db = require("./db");

function normalizeNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLimit(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 50;
	}

	return Math.min(parsed, 200);
}

function createError(statusCode, message) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

const artistKeyExpression = (alias = "artist") => `
	LOWER(
		REPLACE(
			REPLACE(
				REPLACE(
					REPLACE(
						REPLACE(TRIM(${alias}.name), ' ', ''),
						'.',
						''
					),
					'-',
					''
				),
				'''',
				''
			),
			'’',
			''
		)
	)
`;

async function getArtistDuplicates(type = 1, limit = 50) {
	const normalizedType = normalizeNumber(type) || 1;
	const normalizedLimit = normalizeLimit(limit);
	const keyExpression = artistKeyExpression("artist");

	const groups = await db.query(
		`
		SELECT ${keyExpression} AS duplicate_key, COUNT(*) AS total
		FROM artist
		WHERE type = ?
		GROUP BY duplicate_key
		HAVING COUNT(*) > 1
		ORDER BY total DESC, duplicate_key ASC
		LIMIT ${normalizedLimit}
		`,
		[normalizedType]
	);

	const data = [];
	for (const group of groups) {
		const artists = await db.query(
			`
			SELECT artist.id, artist.name, artist.slug, artist.image, artist.type, COUNT(gig.id) AS gig_count
			FROM artist
			LEFT JOIN gig ON gig.artist_id = artist.id
			WHERE artist.type = ? AND ${keyExpression} = ?
			GROUP BY artist.id, artist.name, artist.slug, artist.image, artist.type
			ORDER BY gig_count DESC, artist.name ASC
			`,
			[normalizedType, group.duplicate_key]
		);

		data.push({
			duplicate_key: group.duplicate_key,
			total: Number(group.total) || 0,
			artists
		});
	}

	return { data };
}

async function getGigDuplicates(type = 1, limit = 50) {
	const normalizedType = normalizeNumber(type) || 1;
	const normalizedLimit = normalizeLimit(limit);
	const keyExpression = artistKeyExpression("artist");

	const groups = await db.query(
		`
		SELECT gig.date, gig.venue_id, venue.name AS venue, city.name AS city, ${keyExpression} AS duplicate_key, COUNT(*) AS total
		FROM gig
		INNER JOIN artist ON artist.id = gig.artist_id
		INNER JOIN venue ON venue.id = gig.venue_id
		INNER JOIN city ON city.id = gig.city_id
		WHERE gig.type = ? AND gig.date IS NOT NULL
		GROUP BY gig.date, gig.venue_id, venue.name, city.name, duplicate_key
		HAVING COUNT(*) > 1
		ORDER BY gig.date DESC, venue.name ASC
		LIMIT ${normalizedLimit}
		`,
		[normalizedType]
	);

	const data = [];
	for (const group of groups) {
		const gigs = await db.query(
			`
			SELECT
				gig.id,
				gig.date,
				gig.start_time,
				gig.end_time,
				gig.artist_id,
				artist.name AS artist,
				artist.slug AS artist_slug,
				gig.venue_id,
				venue.name AS venue,
				city.name AS city,
				GROUP_CONCAT(DISTINCT event.id ORDER BY event.id ASC SEPARATOR ',') AS event_ids,
				GROUP_CONCAT(DISTINCT event.name ORDER BY event.date ASC SEPARATOR ' · ') AS event_names,
				GROUP_CONCAT(DISTINCT event_stage.name ORDER BY event_stage.position ASC SEPARATOR ' · ') AS stage_names
			FROM gig
			INNER JOIN artist ON artist.id = gig.artist_id
			INNER JOIN venue ON venue.id = gig.venue_id
			INNER JOIN city ON city.id = gig.city_id
			LEFT JOIN event_gig ON event_gig.gig_id = gig.id
			LEFT JOIN event ON event.id = event_gig.event_id
			LEFT JOIN event_stage ON event_stage.id = event_gig.stage_id
			WHERE gig.type = ?
			  AND gig.date = ?
			  AND gig.venue_id = ?
			  AND ${keyExpression} = ?
			GROUP BY gig.id, gig.date, gig.start_time, gig.end_time, gig.artist_id, artist.name, artist.slug, gig.venue_id, venue.name, city.name
			ORDER BY gig.start_time ASC, artist.name ASC, gig.id ASC
			`,
			[normalizedType, group.date, group.venue_id, group.duplicate_key]
		);

		data.push({
			date: group.date,
			venue_id: group.venue_id,
			venue: group.venue,
			city: group.city,
			duplicate_key: group.duplicate_key,
			total: Number(group.total) || 0,
			gigs
		});
	}

	return { data };
}

async function mergeArtists(payload = {}) {
	const targetArtistId = normalizeNumber(payload.target_artist_id || payload.targetArtistId || payload.target_id);
	const sourceArtistId = normalizeNumber(payload.source_artist_id || payload.sourceArtistId || payload.source_id);

	if (!targetArtistId || !sourceArtistId) {
		throw createError(400, "Define o artista certo e o artista errado.");
	}

	if (targetArtistId === sourceArtistId) {
		throw createError(400, "Os artistas têm de ser diferentes.");
	}

	return db.transaction(async (query) => {
		const artists = await query(
			`
			SELECT id, name
			FROM artist
			WHERE id IN (?, ?)
			`,
			[targetArtistId, sourceArtistId]
		);
		const targetArtist = artists.find((artist) => Number(artist.id) === targetArtistId);
		const sourceArtist = artists.find((artist) => Number(artist.id) === sourceArtistId);

		if (!targetArtist || !sourceArtist) {
			throw createError(404, "Um dos artistas já não existe.");
		}

		const summary = {
			updated_gigs: 0,
			merged_gigs: 0,
			migrated_user_gigs: 0,
			migrated_event_gigs: 0,
			migrated_media: 0,
			migrated_setlists: 0,
			migrated_setlist_songs: 0,
			updated_songs: 0,
			merged_songs: 0
		};

		await mergeSongsIntoTarget(query, sourceArtistId, targetArtistId, summary);

		const sourceGigs = await query(
			`
			SELECT id, venue_id, date
			FROM gig
			WHERE artist_id = ?
			ORDER BY date ASC, id ASC
			`,
			[sourceArtistId]
		);

		for (const sourceGig of sourceGigs) {
			const targetGigs = await query(
				`
				SELECT id
				FROM gig
				WHERE artist_id = ?
				  AND venue_id = ?
				  AND date <=> ?
				  AND id <> ?
				LIMIT 1
				`,
				[targetArtistId, sourceGig.venue_id, sourceGig.date, sourceGig.id]
			);

			if (targetGigs.length) {
				await mergeGigIntoTarget(query, sourceGig.id, targetGigs[0].id, targetArtistId, summary);
				continue;
			}

			await query(`UPDATE gig SET artist_id = ? WHERE id = ?`, [targetArtistId, sourceGig.id]);
			await query(`UPDATE setlist SET artist_id = ? WHERE gig_id = ?`, [`${targetArtistId}`, sourceGig.id]);
			summary.updated_gigs += 1;
		}

		await query(`UPDATE setlist SET artist_id = ? WHERE artist_id = ?`, [`${targetArtistId}`, `${sourceArtistId}`]);
		await query(`DELETE FROM artist WHERE id = ?`, [sourceArtistId]);

		return {
			message: "Merge de artistas concluído.",
			target_artist: targetArtist,
			source_artist: sourceArtist,
			summary
		};
	});
}

async function mergeGigIntoTarget(query, sourceGigId, targetGigId, targetArtistId, summary) {
	const userGigResult = await query(
		`
		INSERT INTO user_gig (user_id, gig_id, status, has_ticket, favorite)
		SELECT user_id, ?, status, has_ticket, favorite
		FROM user_gig
		WHERE gig_id = ?
		ON DUPLICATE KEY UPDATE
			status = IF(user_gig.status = 'going' OR VALUES(status) = 'going', 'going', user_gig.status),
			has_ticket = GREATEST(COALESCE(user_gig.has_ticket, 0), COALESCE(VALUES(has_ticket), 0)),
			favorite = GREATEST(COALESCE(user_gig.favorite, 0), COALESCE(VALUES(favorite), 0))
		`,
		[targetGigId, sourceGigId]
	);
	await query(`DELETE FROM user_gig WHERE gig_id = ?`, [sourceGigId]);
	summary.migrated_user_gigs += userGigResult.affectedRows || 0;

	const eventGigResult = await query(
		`
		INSERT INTO event_gig (event_id, gig_id, stage_id, start_time, end_time)
		SELECT source.event_id, ?, source.stage_id, source.start_time, source.end_time
		FROM event_gig source
		LEFT JOIN event_gig existing ON existing.event_id = source.event_id AND existing.gig_id = ?
		WHERE source.gig_id = ?
		  AND existing.gig_id IS NULL
		`,
		[targetGigId, targetGigId, sourceGigId]
	);
	await query(
		`
		UPDATE event_gig existing
		INNER JOIN event_gig source ON source.event_id = existing.event_id AND source.gig_id = ?
		SET
			existing.stage_id = COALESCE(existing.stage_id, source.stage_id),
			existing.start_time = COALESCE(existing.start_time, source.start_time),
			existing.end_time = COALESCE(existing.end_time, source.end_time)
		WHERE existing.gig_id = ?
		`,
		[sourceGigId, targetGigId]
	);
	await query(`DELETE FROM event_gig WHERE gig_id = ?`, [sourceGigId]);
	summary.migrated_event_gigs += eventGigResult.affectedRows || 0;

	const mediaResult = await query(`UPDATE gig_media SET gig_id = ? WHERE gig_id = ?`, [targetGigId, sourceGigId]);
	summary.migrated_media += mediaResult.affectedRows || 0;

	await mergeSetlistsIntoTargetGig(query, sourceGigId, targetGigId, targetArtistId, summary);
	await query(`DELETE FROM gig WHERE id = ?`, [sourceGigId]);
	summary.merged_gigs += 1;
}

async function mergeSetlistsIntoTargetGig(query, sourceGigId, targetGigId, targetArtistId, summary) {
	const sourceSetlists = await query(`SELECT id FROM setlist WHERE gig_id = ? ORDER BY id ASC`, [sourceGigId]);
	if (!sourceSetlists.length) {
		return;
	}

	const targetSetlists = await query(`SELECT id FROM setlist WHERE gig_id = ? ORDER BY id ASC LIMIT 1`, [targetGigId]);
	if (!targetSetlists.length) {
		const result = await query(`UPDATE setlist SET gig_id = ?, artist_id = ? WHERE gig_id = ?`, [targetGigId, `${targetArtistId}`, sourceGigId]);
		summary.migrated_setlists += result.affectedRows || 0;
		return;
	}

	const targetSetlistId = targetSetlists[0].id;
	for (const sourceSetlist of sourceSetlists) {
		const result = await query(
			`
			INSERT INTO setlist_song (setlist_id, song_id, position, encore)
			SELECT ?, ss.song_id, ss.position, ss.encore
			FROM setlist_song ss
			LEFT JOIN setlist_song existing
				ON existing.setlist_id = ?
				AND existing.song_id = ss.song_id
				AND existing.position = ss.position
				AND COALESCE(existing.encore, 0) = COALESCE(ss.encore, 0)
			WHERE ss.setlist_id = ?
			  AND existing.setlist_id IS NULL
			`,
			[targetSetlistId, targetSetlistId, sourceSetlist.id]
		);
		summary.migrated_setlist_songs += result.affectedRows || 0;

		await query(`DELETE FROM setlist_song WHERE setlist_id = ?`, [sourceSetlist.id]);
		await query(`DELETE FROM setlist WHERE id = ?`, [sourceSetlist.id]);
		summary.migrated_setlists += 1;
	}
}

async function mergeSongsIntoTarget(query, sourceArtistId, targetArtistId, summary) {
	const sourceSongs = await query(
		`
		SELECT id, name
		FROM song
		WHERE artist_id = ?
		ORDER BY id ASC
		`,
		[`${sourceArtistId}`]
	);

	for (const sourceSong of sourceSongs) {
		const targetSongs = await query(
			`
			SELECT id
			FROM song
			WHERE artist_id = ? AND name = ?
			LIMIT 1
			`,
			[`${targetArtistId}`, sourceSong.name]
		);

		if (targetSongs.length) {
			await query(`UPDATE setlist_song SET song_id = ? WHERE song_id = ?`, [targetSongs[0].id, sourceSong.id]);
			await query(`DELETE FROM song WHERE id = ?`, [sourceSong.id]);
			summary.merged_songs += 1;
			continue;
		}

		await query(`UPDATE song SET artist_id = ? WHERE id = ?`, [`${targetArtistId}`, sourceSong.id]);
		summary.updated_songs += 1;
	}
}

module.exports = {
	getArtistDuplicates,
	getGigDuplicates,
	mergeArtists
};
