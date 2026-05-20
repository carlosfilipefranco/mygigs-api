const db = require("./db");
const validStatuses = ["going", "not_going"];

module.exports = {
	setStatus,
	getUserGigs,
	toggleFavorite
};

// Inserir ou atualizar relação user-gig
async function setStatus(userId, gigId, status) {
	if (!validStatuses.includes(status)) {
		return { message: "Invalid status" };
	}

	const result = await db.query(
		`
    INSERT INTO user_gig (user_id, gig_id, status)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE status = VALUES(status)
    `,
		[userId, gigId, status]
	);

	await syncEventStatusByGig(userId, gigId);
	return result;
}

// Listar gigs de um utilizador
async function getUserGigs(userId) {
	return db.query(
		`
    SELECT g.*, ug.status, ug.favorite
    FROM gig g
    INNER JOIN user_gig ug ON ug.gig_id = g.id
    WHERE ug.user_id = ?
    `,
		[userId]
	);
}

// Alternar favorito
async function toggleFavorite(userId, gigId, favorite) {
	return db.query(
		`
    INSERT INTO user_gig (user_id, gig_id, favorite)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE favorite = VALUES(favorite)
    `,
		[userId, gigId, favorite ? 1 : 0]
	);
}

async function syncEventStatusByGig(userId, gigId) {
	const eventRows = await db.query(
		`
		SELECT e.id AS event_id,
		       CASE WHEN e.date < CURDATE() THEN 'attended' ELSE 'going' END AS auto_status
		FROM event_gig eg
		INNER JOIN event e ON e.id = eg.event_id
		WHERE eg.gig_id = ?
		`,
		[gigId]
	);

	for (const eventRow of eventRows) {
		const goingRows = await db.query(
			`
			SELECT COUNT(*) AS total
			FROM event_gig eg
			INNER JOIN user_gig ug ON ug.gig_id = eg.gig_id
			WHERE eg.event_id = ?
			  AND ug.user_id = ?
			  AND ug.status = 'going'
			`,
			[eventRow.event_id, userId]
		);

		const hasGoingGigs = Number(goingRows?.[0]?.total || 0) > 0;

		if (hasGoingGigs) {
			await db.query(
				`
				INSERT INTO user_event (user_id, event_id, status)
				VALUES (?, ?, ?)
				ON DUPLICATE KEY UPDATE status = VALUES(status)
				`,
				[userId, eventRow.event_id, eventRow.auto_status]
			);
			continue;
		}

		await db.query(
			`
			UPDATE user_event
			SET status = NULL
			WHERE user_id = ?
			  AND event_id = ?
			  AND status IN ('going', 'attended')
			`,
			[userId, eventRow.event_id]
		);
	}
}
