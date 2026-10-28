-- Cache partilhada por artista e idioma, independente dos dados pessoais.
CREATE TABLE IF NOT EXISTS artist_metadata (
 artist_id INT NOT NULL,
 language VARCHAR(8) NOT NULL,
 biography MEDIUMTEXT NULL,
 tags JSON NOT NULL,
 source_url VARCHAR(2048) NOT NULL,
 fetched_at DATETIME NULL,
 next_refresh_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 refreshing_until DATETIME NULL,
 PRIMARY KEY (artist_id, language),
 CONSTRAINT artist_metadata_artist_fk FOREIGN KEY (artist_id) REFERENCES artist (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
