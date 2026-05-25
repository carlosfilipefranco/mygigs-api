ALTER TABLE artist
	ADD COLUMN slug VARCHAR(191) NULL AFTER name;

ALTER TABLE event
	ADD COLUMN slug VARCHAR(191) NULL AFTER name;

ALTER TABLE festival
	ADD COLUMN slug VARCHAR(191) NULL AFTER name;

ALTER TABLE edition
	ADD COLUMN slug VARCHAR(191) NULL AFTER name;

CREATE UNIQUE INDEX artist_slug_unique
	ON artist (slug);

CREATE UNIQUE INDEX event_slug_unique
	ON event (slug);

CREATE UNIQUE INDEX festival_slug_unique
	ON festival (slug);

CREATE UNIQUE INDEX edition_slug_unique
	ON edition (slug);
