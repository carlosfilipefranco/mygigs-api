// Executar apenas com uma ligação administrativa explícita à BD de destino.
const mysql = require("mysql2/promise");
const { randomBytes } = require("crypto");
const fs = require("fs/promises");
const path = require("path");

async function main() {
	if (!process.env.DB_ADMIN_URL) throw new Error("Configura DB_ADMIN_URL para a ligação administrativa à base de dados de destino.");
	const url = new URL(process.env.DB_ADMIN_URL);
	const database = decodeURIComponent(url.pathname.slice(1));
	const username = process.env.DB_APP_USER || "mygigs_app";
	if (url.protocol !== "mysql:" || !/^[a-zA-Z0-9_]+$/.test(database) || !/^[a-zA-Z0-9_]{1,32}$/.test(username) || username.toLowerCase() === "root") {
		throw new Error("Ligação ou nome de utilizador inválido.");
	}
	const output = path.resolve(process.argv[2] || ".env.database");
	const file = await fs.open(output, "wx", 0o600);
	const password = randomBytes(32).toString("hex");
	let connection, created = false, complete = false;
	try {
		connection = await mysql.createConnection(process.env.DB_ADMIN_URL);
		await connection.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, password]);
		created = true;
		await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO ?@'%'`, [username]);
		const config = { DB_HOST: url.hostname, DB_PORT: url.port || "3306", DB_NAME: database, DB_USER: username, DB_PASSWORD: password };
		await file.writeFile(Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
		complete = true;
		console.log(`Utilizador limitado criado. Configuração guardada em ${output}. A credencial administrativa não foi alterada.`);
	} finally {
		if (!complete && created) await connection.query("DROP USER ?@'%'", [username]).catch(() => {});
		await connection?.end();
		await file.close();
		if (!complete) await fs.unlink(output);
	}
}

main().catch(error => {
	// Nunca imprimir mensagens do driver: podem incluir credenciais ou SQL sensível.
	console.error(error.code === "EEXIST" ? "O ficheiro de destino já existe; nenhuma alteração foi feita." : "Não foi possível criar o utilizador. Verifica DB_ADMIN_URL, DB_APP_USER e as permissões administrativas.");
	process.exitCode = 1;
});
