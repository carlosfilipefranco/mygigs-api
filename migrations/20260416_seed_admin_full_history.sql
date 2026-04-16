SET @admin_email = 'carlosfilipefranco@gmail.com';
SET @admin_user_id = (
	SELECT id
	FROM `user`
	WHERE email = @admin_email
	LIMIT 1
);

INSERT INTO user_gig (user_id, gig_id, status, favorite)
SELECT @admin_user_id, gig.id, 'going', 0
FROM gig
WHERE @admin_user_id IS NOT NULL
ON DUPLICATE KEY UPDATE
	status = 'going',
	updated_at = CURRENT_TIMESTAMP;

INSERT INTO user_event (user_id, event_id, status, has_ticket, favorite)
SELECT @admin_user_id, event.id, 'attended', 0, 0
FROM event
WHERE @admin_user_id IS NOT NULL
ON DUPLICATE KEY UPDATE
	status = 'attended',
	updated_at = CURRENT_TIMESTAMP;
