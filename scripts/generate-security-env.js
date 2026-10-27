const { randomBytes } = require("crypto");
const fs = require("fs");
const path = require("path");

const output = path.resolve(process.argv[2] || ".env.security");
try {
	fs.writeFileSync(output, `JWT_SECRET=${randomBytes(48).toString("hex")}\nADMIN_SESSION_SECRET=${randomBytes(48).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
	console.log(`Segredos novos guardados em ${output}. O ficheiro não deve ser publicado nem adicionado ao Git.`);
} catch (error) {
	console.error(error.code === "EEXIST" ? "O ficheiro já existe; não foi substituído." : "Não foi possível guardar os segredos.");
	process.exitCode = 1;
}
