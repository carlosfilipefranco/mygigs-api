-- Run through scripts/migrate-user-public-ids.js --apply to also backfill existing users.
ALTER TABLE user
	ADD COLUMN public_id CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NULL,
	ADD UNIQUE KEY user_public_id_unique (public_id);
