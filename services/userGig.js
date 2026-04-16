const db = require("./db");

module.exports = {
	setStatus,
	getUserGigs,
	toggleFavorite
};

// Inserir ou atualizar relação user-gig
async function setStatus(userId, gigId, status) {
	const result = await db.query(
		`
    INSERT INTO user_gig (user_id, gig_id, status)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE status = VALUES(status)
    `,
		[userId, gigId, status]
	);
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
		[userId, gigId, favorite]
	);
}
