ALTER TABLE `user`
ADD COLUMN `role` ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER `password_hash`;

-- Ajusta este email se o teu utilizador administrador for outro.
UPDATE `user`
SET `role` = 'admin'
WHERE `email` = 'carlosfilipefranco@gmail.com';

CREATE TABLE user_event (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NOT NULL,
	event_id INT NOT NULL,
	status ENUM('wishlist', 'going', 'attended', 'missed') DEFAULT NULL,
	has_ticket TINYINT(1) NOT NULL DEFAULT 0,
	favorite TINYINT(1) NOT NULL DEFAULT 0,
	created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY unique_user_event (user_id, event_id),
	KEY event_id (event_id),
	CONSTRAINT user_event_user_fk FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
	CONSTRAINT user_event_event_fk FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
