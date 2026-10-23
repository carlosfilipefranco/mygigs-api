-- Verificar o esquema antes do ALTER permite voltar a executar esta migração.
SET @gig_media_add_user_id = NOT EXISTS (
	SELECT 1
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
	  AND TABLE_NAME = 'gig_media'
	  AND COLUMN_NAME = 'user_id'
);

SET @gig_media_owner_alter = CONCAT_WS(', ',
	IF(@gig_media_add_user_id,
		'ADD COLUMN `user_id` INT NULL AFTER `gig_id`', NULL),
	IF(NOT EXISTS (
		SELECT 1
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = 'gig_media'
		  AND INDEX_NAME = 'gig_media_user_type_id_idx'
	), 'ADD KEY `gig_media_user_type_id_idx` (`user_id`, `type`, `id`)', NULL),
	IF(NOT EXISTS (
		SELECT 1
		FROM information_schema.REFERENTIAL_CONSTRAINTS
		WHERE CONSTRAINT_SCHEMA = DATABASE()
		  AND TABLE_NAME = 'gig_media'
		  AND CONSTRAINT_NAME = 'gig_media_user_fk'
	), 'ADD CONSTRAINT `gig_media_user_fk` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL', NULL)
);

SET @gig_media_owner_sql = IF(
	@gig_media_owner_alter = '',
	'SELECT 1',
	CONCAT('ALTER TABLE `gig_media` ', @gig_media_owner_alter)
);

PREPARE gig_media_owner_statement FROM @gig_media_owner_sql;
EXECUTE gig_media_owner_statement;
DEALLOCATE PREPARE gig_media_owner_statement;

-- Atribuir as fotografias antigas apenas quando a coluna é criada nesta execução.
-- Ao repetir, preservar também os autores nulos de contas entretanto eliminadas.
UPDATE `gig_media`
SET `user_id` = 1
WHERE @gig_media_add_user_id = 1 AND `type` = 'image' AND `user_id` IS NULL;
