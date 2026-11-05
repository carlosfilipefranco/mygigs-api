-- Os registos existentes mantêm NULL: os sets que já se perderam só podem ser recuperados da fonte.
-- Esta migração é aditiva e pode ser repetida.
SET @setlist_sets_alter = CONCAT_WS(', ',
 IF(NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'setlist_song' AND COLUMN_NAME = 'set_position'
 ), 'ADD COLUMN set_position INT UNSIGNED NULL DEFAULT NULL', NULL),
 IF(NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'setlist_song' AND COLUMN_NAME = 'set_name'
 ), 'ADD COLUMN set_name TEXT NULL', NULL)
);
SET @setlist_sets_sql = IF(@setlist_sets_alter = '', 'SELECT 1', CONCAT('ALTER TABLE setlist_song ', @setlist_sets_alter));
PREPARE setlist_sets_statement FROM @setlist_sets_sql;
EXECUTE setlist_sets_statement;
DEALLOCATE PREPARE setlist_sets_statement;
