CREATE TABLE IF NOT EXISTS gig_comment (
	id INT NOT NULL AUTO_INCREMENT,
	gig_id INT NOT NULL,
	user_id INT NULL,
	body VARCHAR(2000) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	KEY gig_comment_gig_id_idx (gig_id, id),
	KEY gig_comment_user_idx (user_id),
	CONSTRAINT gig_comment_gig_fk FOREIGN KEY (gig_id) REFERENCES gig (id) ON DELETE CASCADE,
	CONSTRAINT gig_comment_user_fk FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
