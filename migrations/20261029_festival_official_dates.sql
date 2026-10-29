-- As datas oficiais não são substituídas pelo intervalo dos concertos importados.
SET @festival_dates_sql = IF(
 NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edition' AND COLUMN_NAME = 'dates_confirmed'),
 'ALTER TABLE edition ADD COLUMN dates_confirmed TINYINT(1) NOT NULL DEFAULT 0',
 'SELECT 1'
);
PREPARE festival_dates_statement FROM @festival_dates_sql;
EXECUTE festival_dates_statement;
DEALLOCATE PREPARE festival_dates_statement;
