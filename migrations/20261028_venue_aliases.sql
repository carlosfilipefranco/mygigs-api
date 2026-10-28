-- Um espaço físico pode ter vários nomes. Os IDs antigos continuam resolúveis.
CREATE TABLE IF NOT EXISTS venue_alias (
 id INT NOT NULL AUTO_INCREMENT,
 venue_id INT NOT NULL,
 name VARCHAR(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
 PRIMARY KEY (id),
 UNIQUE KEY venue_alias_name_unique (venue_id, name),
 KEY venue_alias_name_idx (name),
 CONSTRAINT venue_alias_venue_fk FOREIGN KEY (venue_id) REFERENCES venue (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venue_redirect (
 source_venue_id INT NOT NULL,
 venue_id INT NOT NULL,
 venue_alias_id INT NULL,
 PRIMARY KEY (source_venue_id),
 KEY venue_redirect_venue_idx (venue_id),
 CONSTRAINT venue_redirect_venue_fk FOREIGN KEY (venue_id) REFERENCES venue (id) ON DELETE CASCADE,
 CONSTRAINT venue_redirect_alias_fk FOREIGN KEY (venue_alias_id) REFERENCES venue_alias (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserva o nome associado ao registo, independentemente de futuras mudanças.
SET @venue_alias_alter = CONCAT_WS(', ',
 IF(NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gig' AND COLUMN_NAME = 'venue_alias_id'), 'ADD COLUMN venue_alias_id INT NULL', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gig' AND INDEX_NAME = 'gig_venue_alias_idx'), 'ADD KEY gig_venue_alias_idx (venue_alias_id)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'gig' AND CONSTRAINT_NAME = 'gig_venue_alias_fk'), 'ADD CONSTRAINT gig_venue_alias_fk FOREIGN KEY (venue_alias_id) REFERENCES venue_alias (id) ON DELETE SET NULL', NULL)
);
SET @venue_alias_sql = IF(@venue_alias_alter = '', 'SELECT 1', CONCAT('ALTER TABLE gig ', @venue_alias_alter));
PREPARE venue_alias_statement FROM @venue_alias_sql;
EXECUTE venue_alias_statement;
DEALLOCATE PREPARE venue_alias_statement;

-- Preserva o nome associado ao registo, independentemente de futuras mudanças.
SET @venue_alias_alter = CONCAT_WS(', ',
 IF(NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND COLUMN_NAME = 'venue_alias_id'), 'ADD COLUMN venue_alias_id INT NULL', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND INDEX_NAME = 'event_venue_alias_idx'), 'ADD KEY event_venue_alias_idx (venue_alias_id)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND CONSTRAINT_NAME = 'event_venue_alias_fk'), 'ADD CONSTRAINT event_venue_alias_fk FOREIGN KEY (venue_alias_id) REFERENCES venue_alias (id) ON DELETE SET NULL', NULL)
);
SET @venue_alias_sql = IF(@venue_alias_alter = '', 'SELECT 1', CONCAT('ALTER TABLE event ', @venue_alias_alter));
PREPARE venue_alias_statement FROM @venue_alias_sql;
EXECUTE venue_alias_statement;
DEALLOCATE PREPARE venue_alias_statement;

-- Preserva o nome associado ao registo, independentemente de futuras mudanças.
SET @venue_alias_alter = CONCAT_WS(', ',
 IF(NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edition' AND COLUMN_NAME = 'venue_alias_id'), 'ADD COLUMN venue_alias_id INT NULL', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edition' AND INDEX_NAME = 'edition_venue_alias_idx'), 'ADD KEY edition_venue_alias_idx (venue_alias_id)', NULL),
 IF(NOT EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'edition' AND CONSTRAINT_NAME = 'edition_venue_alias_fk'), 'ADD CONSTRAINT edition_venue_alias_fk FOREIGN KEY (venue_alias_id) REFERENCES venue_alias (id) ON DELETE SET NULL', NULL)
);
SET @venue_alias_sql = IF(@venue_alias_alter = '', 'SELECT 1', CONCAT('ALTER TABLE edition ', @venue_alias_alter));
PREPARE venue_alias_statement FROM @venue_alias_sql;
EXECUTE venue_alias_statement;
DEALLOCATE PREPARE venue_alias_statement;

