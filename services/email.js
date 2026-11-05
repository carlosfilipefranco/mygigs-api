const fetch = require("node-fetch");
const ejs = require("ejs");
const { readFile } = require("fs/promises");
const path = require("path");

async function passwordResetContent(code) {
	const templateRoot = path.join(__dirname, "../templates/emails");
	const [html, logo] = await Promise.all([
		ejs.renderFile(path.join(templateRoot, "password-reset.ejs"), { code }),
		readFile(path.join(templateRoot, "assets/na-grade-logo.png"))
	]);
	return {
		html,
		text: `Recebemos um pedido para redefinir a palavra-passe da tua conta no Na Grade.\n\nO teu código de recuperação é: ${code}\n\nVolta ao site, introduz este código e escolhe uma nova palavra-passe.\n\nO código é válido durante 10 minutos e só pode ser utilizado uma vez. Não partilhes este código com ninguém.\n\nSe não fizeste este pedido, ignora este email. A tua palavra-passe mantém-se igual.`,
		attachments: [{ filename: "na-grade-logo.png", content: logo.toString("base64"), content_id: "na-grade-logo" }]
	};
}

function configuration() {
	const apiKey = process.env.RESEND_API_KEY?.trim();
	const from = process.env.EMAIL_FROM?.trim();
	if (!apiKey || !from || /[\r\n]/.test(from)) {
		throw Object.assign(new Error("O envio de emails está temporariamente indisponível."), { statusCode: 503 });
	}
	return { apiKey, from };
}

async function sendPasswordReset(to, code) {
	const { apiKey, from } = configuration();
	try {
		const content = await passwordResetContent(code);
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from,
				to: [to],
				subject: "Recuperar palavra-passe — Na Grade",
				...content
			}),
			timeout: 10000,
			redirect: "error"
		});
		if (!response.ok) {
			// Não registar o corpo da resposta: pode conter o destinatário ou o código.
			console.error("Password reset email rejected by provider", response.status);
			throw new Error("Email delivery failed");
		}
	} catch {
		throw Object.assign(new Error("Não foi possível enviar o email de recuperação."), { statusCode: 503 });
	}
}

module.exports = { configuration, sendPasswordReset, passwordResetContent };
