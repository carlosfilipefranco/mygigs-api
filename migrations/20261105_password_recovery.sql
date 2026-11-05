ALTER TABLE user ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE user_password_reset (
	user_id INT NOT NULL,
	token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	expires_at DATETIME NOT NULL,
	requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id),
	UNIQUE KEY user_password_reset_token_idx (token_hash),
	CONSTRAINT user_password_reset_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
