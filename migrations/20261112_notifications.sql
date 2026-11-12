CREATE TABLE IF NOT EXISTS user_notification_preferences (
	user_id INT NOT NULL PRIMARY KEY,
	enabled TINYINT(1) NOT NULL DEFAULT 1,
	new_concerts TINYINT(1) NOT NULL DEFAULT 1,
	gig_changes TINYINT(1) NOT NULL DEFAULT 1,
	onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
	CONSTRAINT notification_preferences_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_follow (
	user_id INT NOT NULL,
	entity_type VARCHAR(16) NOT NULL,
	entity_id INT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, entity_type, entity_id),
	KEY follow_entity_idx (entity_type, entity_id, user_id),
	CONSTRAINT follow_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_notification (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
	user_id INT NOT NULL,
	event_key CHAR(36) NOT NULL,
	kind VARCHAR(24) NOT NULL,
	title VARCHAR(255) NOT NULL,
	body VARCHAR(2000) NOT NULL,
	path VARCHAR(255) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	read_at TIMESTAMP NULL DEFAULT NULL,
	UNIQUE KEY notification_event_idx (user_id, event_key),
	KEY notification_inbox_idx (user_id, id),
	KEY notification_unread_idx (user_id, read_at, id),
	CONSTRAINT notification_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
