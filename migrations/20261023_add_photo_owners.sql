ALTER TABLE `gig_media`
	ADD COLUMN `user_id` INT NULL AFTER `gig_id`,
	ADD KEY `gig_media_user_type_id_idx` (`user_id`, `type`, `id`),
	ADD CONSTRAINT `gig_media_user_fk` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL;

-- Apenas as fotografias anteriores à associação de autores são atribuídas ao utilizador 1.
UPDATE `gig_media`
SET `user_id` = 1
WHERE `type` = 'image' AND `user_id` IS NULL;
