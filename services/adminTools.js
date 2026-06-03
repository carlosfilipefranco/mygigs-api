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

module.exports = {
	getArtistDuplicates,
	getGigDuplicates
};
