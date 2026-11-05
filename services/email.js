const fetch = require("node-fetch");

function configuration() {
	const apiKey = process.env.RESEND_API_KEY?.trim();
	const from = process.env.EMAIL_FROM?.trim();
	if (!apiKey || !from || /[\r\n]/.test(from)) {
		throw Object.assign(new Error("O envio de emails está temporariamente indisponível."), { statusCode: 503 });
	}
	return { apiKey, from };
}

async function sendPasswordReset(to, resetUrl) {
	const { apiKey, from } = configuration();
	try {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from,
				to: [to],
				subject: "Recuperar palavra-passe — Na Grade",
				text: `Recebemos um pedido para redefinir a palavra-passe da tua conta no Na Grade.\n\nAbre este link para escolher uma nova palavra-passe:\n${resetUrl}\n\nO link é válido durante 30 minutos e só pode ser utilizado uma vez.\n\nSe não fizeste este pedido, ignora este email. A tua palavra-passe mantém-se igual.`
			}),
			timeout: 10000,
			redirect: "error"
		});
		if (!response.ok) {
			// Não registar o corpo da resposta: pode conter o destinatário ou o link.
			console.error("Password reset email rejected by provider", response.status);
			throw new Error("Email delivery failed");
		}
	} catch {
		throw Object.assign(new Error("Não foi possível enviar o email de recuperação."), { statusCode: 503 });
	}
}

module.exports = { configuration, sendPasswordReset };
