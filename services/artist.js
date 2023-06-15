const db = require("./db");
const helper = require("../helper");
const config = require("../config");
const fetch = require("node-fetch");
const lastFmKey = "aef314af1cb8fbe8e84aca457c5b70e8";
const fanartKey = "a9722f9e6e7aa1e040c0dd5d3d23e4e2";
const spotify_client_id = "adc9c5b33c7145a5b7b8967c9c7ba74e";
const spotify_client_secret = "918d3fc1370245e8bbc151318ccbff2f";
var spotifyKey = "";

async function getMultiple(page = 1, search = null) {
	const offset = helper.getOffset(page, config.listPerPage);
	let searchQuery = "";
	if (search) {
		searchQuery = `WHERE LOWER(artist.name) LIKE '%${search}%'`;
	}
	const rows = await db.query(`SELECT id, name, image FROM artist ${searchQuery} ORDER BY name LIMIT ${offset},${config.listPerPage}`);
	const data = helper.emptyOrRows(rows);

	let count = rows.length;
	if (!search) {
		let row = await db.query(`SELECT COUNT(*) as count FROM artist`);
		count = row[0].count;
	}

	const meta = { page, count };

	return {
		data,
		meta
	};
}

async function get(id) {
	let result = await db.query(`SELECT id, name, image, mbid FROM artist WHERE id=${id}`);
	if (result.length) {
		result = result[0];
		const gigs = await db.query(`SELECT gig.id, gig.date, artist.name as artist, artist.image, venue.name as venue, city.name as city FROM gig INNER JOIN artist ON gig.artist_id = artist.id INNER JOIN venue ON gig.venue_id = venue.id INNER JOIN city ON gig.city_id = city.id WHERE gig.artist_id = ${result.id} ORDER by gig.date DESC `);
		const lastfm = await fetch("https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=" + result.name + "&api_key=" + lastFmKey + "&format=json&index=" + id);

		let headers = {
			"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
		};
		const spotifyToken = await fetch(`https://accounts.spotify.com/api/token`, { method: "POST", headers, body: `grant_type=client_credentials&client_id=${spotify_client_id}&client_secret=${spotify_client_secret}` });
		if (spotifyToken.status == 200) {
			let json = await spotifyToken.json();
			spotifyKey = json.access_token;
			headers["Authorization"] = `Bearer ${spotifyKey}`;
			const spotify = await fetch(`https://api.spotify.com/v1/search?q=${result.name}&type=artist`, { headers });
			if (spotify.status === 200) {
				let spotifyJson = await spotify.json();

				if (typeof spotifyJson.artists.items[0].images[0].url != "undefined") {
					const image = spotifyJson.artists.items[0].images[0].url;
					result["image"] = image;
					await db.query(`UPDATE artist SET image="${image}" WHERE id=${id}`);
				}
			}
		}

		const body = await lastfm.json();
		result["body"] = body;
		result["gigs"] = gigs;
	} else {
		result = null;
	}

	return result;
}

async function create(artist) {
	const rows = await db.query(`SELECT id FROM artist WHERE name="${artist.name}"`);
	var result;

	if (rows.length) {
		const id = rows[0].id;
		result = await db.query(`UPDATE artist SET name="${artist.name}", image="${artist.image}", mbid="${artist.mbid}" WHERE id=${id}`);
	} else {
		result = await db.query(`INSERT INTO artist (name, image, mbid)  VALUES  ("${artist.name}", "${artist.image}", "${artist.mbid}")`);
	}

	let message = "Error in creating Artist";

	if (result.affectedRows) {
		message = "Artist created successfully";
	}

	return result;
}

async function update(id, artist) {
	const result = await db.query(`UPDATE artist SET name="${artist.name}", image=${artist.image} WHERE id=${id}`);

	let message = "Error in updating Artist";

	if (result.affectedRows) {
		message = "Artist updated successfully";
	}

	return { message };
}

async function remove(id) {
	const result = await db.query(`DELETE FROM artist WHERE id=${id}`);

	let message = "Error in deleting Artist";

	if (result.affectedRows) {
		message = "Artist deleted successfully";
	}

	return { message };
}

module.exports = {
	getMultiple,
	get,
	create,
	update,
	remove
};
