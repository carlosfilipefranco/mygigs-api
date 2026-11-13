const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const config = require("../config");
const { isPublicId, withPublicId } = require("../services/userPublicId");

async function main() {
	const args = process.argv.slice(2);
	if (args.some(arg => !["--apply", "--finalize"].includes(arg))) throw new Error("Opções inválidas. Usa --apply e, após publicar a API, --finalize.");
	const finalize = args.includes("--finalize");
	if (!args.includes("--apply")) {
		console.log("Cria public_id e gera códigos aleatórios de 12 caracteres para as contas existentes, mantendo compatibilidade com os registos da API antiga.");
		console.log("Para aplicar à base de dados configurada: node scripts/migrate-user-public-ids.js --apply");
		console.log("Só após publicar a nova API, tornar a coluna obrigatória: node scripts/migrate-user-public-ids.js --apply --finalize");
		return;
	}
	const connection = await mysql.createConnection({ ...config.db, connectTimeout: 15000 });
	let locked = false;
	try {
		const [locks] = await connection.execute("SELECT GET_LOCK(CONCAT(LEFT(DATABASE(), 32), ':user-public-ids'), 10) AS acquired");
		if (Number(locks[0].acquired) !== 1) throw new Error("Já está a decorrer uma migração dos identificadores públicos.");
		locked = true;
		const [columns] = await connection.execute("SHOW COLUMNS FROM user LIKE 'public_id'");
		if (!columns.length) {
			const sql = await fs.readFile(path.join(__dirname, "../migrations/20261113_user_public_ids.sql"), "utf8");
			await connection.query(sql);
		} else {
			const [indexes] = await connection.execute("SHOW INDEX FROM user WHERE Key_name = 'user_public_id_unique'");
			if (!indexes.length) await connection.execute("ALTER TABLE user ADD UNIQUE KEY user_public_id_unique (public_id)");
		}
		let count = 0;
		while (true) {
			const [users] = await connection.execute("SELECT id FROM user WHERE public_id IS NULL ORDER BY id LIMIT 500");
			if (!users.length) break;
			for (const user of users) {
				const { result } = await withPublicId(publicId => connection.execute("UPDATE user SET public_id = ? WHERE id = ? AND public_id IS NULL", [publicId, user.id]));
				count += result[0].affectedRows;
			}
		}
		const [users] = await connection.execute("SELECT public_id FROM user");
		if (users.some(user => !isPublicId(user.public_id))) throw new Error("Existem identificadores públicos inválidos; corrige-os antes de concluir a migração.");
		if (finalize && (!columns.length || columns[0].Null === "YES")) {
			await connection.execute("ALTER TABLE user MODIFY public_id CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL");
		}
		console.log(`Migração concluída: ${count} identificadores criados. Os códigos existentes foram preservados.`);
		if (!finalize && (!columns.length || columns[0].Null === "YES")) {
			console.log("A coluna permanece opcional para a API antiga. Após publicar a nova API, executar novamente com --apply --finalize.");
		}
	} finally {
		try {
			if (locked) await connection.execute("SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(), 32), ':user-public-ids'))");
		} finally {
			await connection.end();
		}
	}
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
