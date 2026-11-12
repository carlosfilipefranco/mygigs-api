CREATE TABLE IF NOT EXISTS user_push_subscription (
	id CHAR(36) NOT NULL PRIMARY KEY,
	user_id INT NOT NULL,
	endpoint_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	auth VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY push_endpoint_unique (endpoint_hash),
	KEY push_subscription_user_idx (user_id),
	CONSTRAINT push_subscription_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_push_delivery (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
	notification_id BIGINT UNSIGNED NOT NULL,
	subscription_id CHAR(36) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
	available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	locked_until TIMESTAMP NULL DEFAULT NULL,
	lock_token CHAR(36) NULL,
	sent_at TIMESTAMP NULL DEFAULT NULL,
	last_error VARCHAR(64) NULL,
	UNIQUE KEY push_delivery_unique (notification_id, subscription_id),
	KEY push_delivery_pending_idx (status, available_at, locked_until),
	KEY push_delivery_subscription_idx (subscription_id),
	CONSTRAINT push_delivery_notification_fk FOREIGN KEY (notification_id) REFERENCES user_notification (id) ON DELETE CASCADE,
	CONSTRAINT push_delivery_subscription_fk FOREIGN KEY (subscription_id) REFERENCES user_push_subscription (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
