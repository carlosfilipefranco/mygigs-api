const fetch = require("node-fetch");

const API_KEY = "33b04241-2c2f-45e6-959a-ddf01429fc76";

async function getSetlist(artist, city, date) {
	if (!artist || !city || !date) {
		throw new Error("Parâmetros obrigatórios em falta: artist, city, date");
	}

	const url = new URL("https://api.setlist.fm/rest/1.0/search/setlists");
	url.searchParams.append("artistName", artist);
	url.searchParams.append("cityName", city);
	url.searchParams.append("date", date);

	const response = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"x-api-key": API_KEY,
			"User-Agent": "concert-app/1.0"
		}
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Erro na API setlist.fm: ${response.status} - ${text}`);
	}

	const data = await response.json();
	return data;
}

module.exports = {
	getSetlist
};
