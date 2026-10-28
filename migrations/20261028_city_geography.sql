-- Países e divisões administrativas; sem atribuição automática de Portugal.
CREATE TABLE IF NOT EXISTS country (
 code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS country_subdivision (
 id INT UNSIGNED NOT NULL AUTO_INCREMENT,
 country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 kind VARCHAR(32) NOT NULL,
 PRIMARY KEY (id),
 UNIQUE KEY country_subdivision_name_unique (country_code, name),
 UNIQUE KEY country_subdivision_country_id_unique (country_code, id),
 CONSTRAINT country_subdivision_country_fk FOREIGN KEY (country_code) REFERENCES country (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Alteração repetível e aditiva: mantém os IDs, nomes e state existentes.
SET @city_geography_alter = CONCAT_WS(', ',
 IF(NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND COLUMN_NAME = 'country_code'), 'ADD COLUMN country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NULL', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND COLUMN_NAME = 'subdivision_id'), 'ADD COLUMN subdivision_id INT UNSIGNED NULL', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND INDEX_NAME = 'city_country_subdivision_idx'), 'ADD KEY city_country_subdivision_idx (country_code, subdivision_id)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND CONSTRAINT_NAME = 'city_country_fk'), 'ADD CONSTRAINT city_country_fk FOREIGN KEY (country_code) REFERENCES country (code)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND CONSTRAINT_NAME = 'city_country_subdivision_fk'), 'ADD CONSTRAINT city_country_subdivision_fk FOREIGN KEY (country_code, subdivision_id) REFERENCES country_subdivision (country_code, id)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'city' AND CONSTRAINT_NAME = 'city_subdivision_requires_country'), 'ADD CONSTRAINT city_subdivision_requires_country CHECK (subdivision_id IS NULL OR country_code IS NOT NULL)', NULL)
);
SET @city_geography_sql = IF(@city_geography_alter = '', 'SELECT 1', CONCAT('ALTER TABLE city ', @city_geography_alter));
PREPARE city_geography_statement FROM @city_geography_sql;
EXECUTE city_geography_statement;
DEALLOCATE PREPARE city_geography_statement;
