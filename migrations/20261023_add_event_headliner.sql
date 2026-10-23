-- Pode ser repetida, incluindo quando a coluna já foi criada manualmente.
SET @event_headliner_alter = CONCAT_WS(', ',
	IF(NOT EXISTS (
		SELECT 1 FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND COLUMN_NAME = 'headliner_artist_id'
	), 'ADD COLUMN `headliner_artist_id` INT NULL', NULL),
	IF(NOT EXISTS (
		SELECT 1 FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND INDEX_NAME = 'event_headliner_artist_idx'
	), 'ADD KEY `event_headliner_artist_idx` (`headliner_artist_id`)', NULL),
	IF(NOT EXISTS (
		SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
		WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND CONSTRAINT_NAME = 'event_headliner_artist_fk'
	), 'ADD CONSTRAINT `event_headliner_artist_fk` FOREIGN KEY (`headliner_artist_id`) REFERENCES `artist` (`id`) ON DELETE SET NULL', NULL)
);
SET @event_headliner_sql = IF(@event_headliner_alter = '', 'SELECT 1', CONCAT('ALTER TABLE `event` ', @event_headliner_alter));
PREPARE event_headliner_statement FROM @event_headliner_sql;
EXECUTE event_headliner_statement;
DEALLOCATE PREPARE event_headliner_statement;

-- Não inferir o cabeça de cartaz dos eventos existentes com vários artistas.
