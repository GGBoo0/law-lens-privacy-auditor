CREATE TABLE `rate_windows` (
	`client_key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
