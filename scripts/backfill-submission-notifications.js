// Recover missing links without sending another notification or changing read state.
const mysql = require('mysql2/promise');
const config = require('../config');
const { submissionReviewContent } = require('../services/notifications');

async function main() {
	const apply = process.argv.includes('--apply');
	const selected = process.argv.find(arg => arg.startsWith('--submission='));
	const id = Number(selected?.split('=')[1]);
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Indica --submission=<id>. Sem --apply é apenas uma pré-visualização.');
	const connection = await mysql.createConnection(config.db);
	const query = async (sql, params) => (await connection.execute(sql, params))[0];
	try {
		if (apply) await connection.beginTransaction();
		const submissions = await query(`SELECT * FROM user_submission WHERE id = ? AND status = 'approved' AND entity_type = 'event'${apply ? ' FOR UPDATE' : ''}`, [id]);
		if (!submissions.length) throw new Error('Sugestão aprovada não encontrada.');
		const submission = submissions[0];
		const payload = typeof submission.payload === 'string' ? JSON.parse(submission.payload) : submission.payload;
		const notes = await query(`SELECT id FROM user_notification WHERE user_id = ? AND kind = 'submission_review'
			AND title LIKE 'Sugestão aprovada%' AND path = '/notificacoes'
			AND ABS(TIMESTAMPDIFF(SECOND, created_at, ?)) <= 5${apply ? ' FOR UPDATE' : ''}`, [submission.user_id, submission.reviewed_at]);
		if (notes.length !== 1) throw new Error('Não existe uma única notificação sem ligação que corresponda à decisão. Nada foi alterado.');
		let gigIds = payload.review?.gig_ids || [];
		let eventIds = payload.review?.event_ids || [];
		if (!gigIds.length) {
			const venue = Number(payload.venue_id || payload.venue?.id);
			const artists = Array.isArray(payload.artists) ? payload.artists : [];
			if (!venue || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !artists.length) throw new Error('Faltam dados para recuperar a ligação com segurança.');
			const resolved = [];
			for (const artist of artists) {
				const artistId = Number(artist.artist_id || artist.artist?.id || artist.id);
				if (!Number.isSafeInteger(artistId) || artistId <= 0) throw new Error('Artista inválido na sugestão antiga.');
				const gigs = await query(`SELECT g.id, eg.event_id FROM gig g INNER JOIN event_gig eg ON eg.gig_id = g.id
					WHERE g.artist_id = ? AND g.venue_id = ? AND g.date = ? AND g.type = ? LIMIT 2`, [artistId, venue, payload.date, Number(payload.type) || 1]);
				if (gigs.length !== 1) throw new Error('Não existe um único concerto que corresponda a artista, local e data. Nada foi alterado.');
				resolved.push(gigs[0]);
			}
			gigIds = [...new Set(resolved.map(gig => gig.id))];
			eventIds = [...new Set(resolved.map(gig => gig.event_id))];
		}
		payload.review = { ...payload.review, gig_ids: gigIds, event_ids: eventIds };
		const content = await submissionReviewContent(query, { ...submission, payload }, true, null, payload.review.message || '');
		if (content.path === '/notificacoes') throw new Error('O concerto já não está disponível. Nada foi alterado.');
		console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', submission: id, notification: notes[0].id, ...content }, null, 2));
		if (apply) {
			await query('UPDATE user_submission SET payload = ? WHERE id = ?', [JSON.stringify(payload), id]);
			await query('UPDATE user_notification SET title = ?, body = ?, path = ? WHERE id = ?', [content.title, content.body, content.path, notes[0].id]);
			await connection.commit();
		}
	} catch (error) {
		if (apply) await connection.rollback();
		throw error;
	} finally { await connection.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
