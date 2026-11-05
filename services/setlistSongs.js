function flattenSetlistSongs(sets) {
	if (!Array.isArray(sets)) return [];
	return sets.flatMap((set, index) => {
		if (!set || (set.song != null && !Array.isArray(set.song))) {
			throw Object.assign(new Error("O setlist.fm devolveu uma estrutura de sets inválida."), { statusCode: 502 });
		}
		const encore = Number.isSafeInteger(Number(set.encore)) && Number(set.encore) > 0 ? Number(set.encore) : 0;
		const setName = typeof set.name === "string" ? set.name.trim() || null : null;
		return (set.song || []).filter(song => typeof song?.name === "string" && song.name.trim())
			.map(song => ({ name: song.name.trim(), encore, set_position: index + 1, set_name: setName }));
	});
}

module.exports = { flattenSetlistSongs };
