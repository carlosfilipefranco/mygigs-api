// Expressões partilhadas: uma data estimada serve para ordenar, nunca para declarar um concerto como visto.
function editionDate(alias = "gig", field = "date_start") {
	return `(SELECT MIN(ed.${field}) FROM event_gig cdg INNER JOIN edition_event cde ON cde.event_id = cdg.event_id
		INNER JOIN edition ed ON ed.id = cde.edition_id WHERE cdg.gig_id = ${alias}.id)`;
}

function upcomingGig(alias = "gig") {
	return `(${alias}.date >= CURDATE() OR (${alias}.date IS NULL AND ${editionDate(alias, "date_end")} >= CURDATE()))`;
}

function gigSortDate(alias = "gig") {
	return `COALESCE(${alias}.date, GREATEST(CURDATE(), ${editionDate(alias)}))`;
}

function eventEditionDate(alias = "event", field = "date_start") {
	return `(SELECT MIN(ed.${field}) FROM edition_event cde INNER JOIN edition ed ON ed.id = cde.edition_id WHERE cde.event_id = ${alias}.id)`;
}

function upcomingEvent(alias = "event") {
	return `(${alias}.date >= CURDATE() OR (${alias}.date IS NULL AND ${eventEditionDate(alias, "date_end")} >= CURDATE()))`;
}

module.exports = { editionDate, upcomingGig, gigSortDate, eventEditionDate, upcomingEvent };
