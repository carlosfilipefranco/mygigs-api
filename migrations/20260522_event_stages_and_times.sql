CREATE TABLE IF NOT EXISTS `event_stage` (
	`id` INT NOT NULL AUTO_INCREMENT,
	`event_id` INT NOT NULL,
	`name` VARCHAR(255) NOT NULL,
	`position` INT NOT NULL DEFAULT 1,
	`created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (`id`),
	KEY `event_stage_event_id_idx` (`event_id`),
	KEY `event_stage_event_position_idx` (`event_id`, `position`),
	CONSTRAINT `event_stage_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `gig`
	ADD COLUMN `start_time` TIME NULL AFTER `date`,
	ADD COLUMN `end_time` TIME NULL AFTER `start_time`;

ALTER TABLE `event_gig`
	ADD COLUMN `stage_id` INT NULL AFTER `event_id`,
	ADD COLUMN `start_time` TIME NULL AFTER `stage_id`,
	ADD COLUMN `end_time` TIME NULL AFTER `start_time`,
	ADD KEY `fk_event_gig_stage` (`stage_id`),
	ADD CONSTRAINT `fk_event_gig_stage` FOREIGN KEY (`stage_id`) REFERENCES `event_stage` (`id`) ON DELETE SET NULL;
