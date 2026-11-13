CREATE TABLE IF NOT EXISTS user_registration_code (
	email VARCHAR(150) NOT NULL,
	token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
	expires_at DATETIME NOT NULL,
	requested_at DATETIME NOT NULL,
	failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
	request_window_start DATETIME NOT NULL,
	request_count INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (email),
	KEY registration_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
