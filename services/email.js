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

async function registrationCodeContent(code) {
	const templateRoot = path.join(__dirname, "../templates/emails");
	const [html, logo] = await Promise.all([
		ejs.renderFile(path.join(templateRoot, "registration-code.ejs"), { code }),
		readFile(path.join(templateRoot, "assets/na-grade-logo.png"))
	]);
	return {
		html,
		text: `Confirma o teu email para criar a tua conta no Na Grade.\n\nO teu código de confirmação é: ${code}\n\nVolta ao site e introduz este código para concluir o registo.\n\nO código é válido durante 10 minutos e só pode ser utilizado uma vez. Não partilhes este código com ninguém.\n\nSe não fizeste este pedido, ignora este email. Nenhuma conta será criada sem a confirmação.`,
		attachments: [{ filename: "na-grade-logo.png", content: logo.toString("base64"), content_id: "na-grade-logo" }]
	};
}

async function sendCodeEmail(to, code, { content, subject, label, failureMessage }) {
	const { apiKey, from } = configuration();
	try {
		const rendered = await content(code);
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({ from, to: [to], subject, ...rendered }),
			timeout: 10000,
			redirect: "error"
		});
		if (!response.ok) {
			// Não registar o corpo da resposta: pode conter o destinatário ou o código.
			console.error(`${label} email rejected by provider`, response.status);
			throw new Error("Email delivery failed");
		}
	} catch {
		throw Object.assign(new Error(failureMessage), { statusCode: 503 });
	}
}

function sendPasswordReset(to, code) {
	return sendCodeEmail(to, code, {
		content: passwordResetContent, subject: "Recuperar palavra-passe — Na Grade",
		label: "Password reset", failureMessage: "Não foi possível enviar o email de recuperação."
	});
}

function sendRegistrationCode(to, code) {
	return sendCodeEmail(to, code, {
		content: registrationCodeContent, subject: "Confirmar email — Na Grade",
		label: "Registration", failureMessage: "Não foi possível enviar o email de confirmação."
	});
}

module.exports = { configuration, sendPasswordReset, passwordResetContent, sendRegistrationCode, registrationCodeContent };
