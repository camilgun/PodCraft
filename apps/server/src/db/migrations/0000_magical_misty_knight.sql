CREATE TABLE `analysis_results` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`summary` text NOT NULL,
	`suggested_title` text NOT NULL,
	`chapters` text NOT NULL,
	`editorial_notes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `edit_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`analysis_result_id` text,
	`type` text NOT NULL,
	`subtype` text,
	`start_time` real NOT NULL,
	`end_time` real NOT NULL,
	`original_text` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` real NOT NULL,
	`proposed_position` real,
	`status` text DEFAULT 'proposed' NOT NULL,
	`user_start_time` real,
	`user_end_time` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_result_id`) REFERENCES `analysis_results`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quality_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`window_start` real NOT NULL,
	`window_end` real NOT NULL,
	`mos` real NOT NULL,
	`noisiness` real NOT NULL,
	`discontinuity` real NOT NULL,
	`coloration` real NOT NULL,
	`loudness` real NOT NULL,
	`flagged` integer DEFAULT 0 NOT NULL,
	`flagged_by` text DEFAULT 'auto' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`duration_seconds` real NOT NULL,
	`sample_rate` integer NOT NULL,
	`channels` integer NOT NULL,
	`format` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`status` text DEFAULT 'IMPORTED' NOT NULL,
	`language_detected` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`full_text` text NOT NULL,
	`segments` text NOT NULL,
	`model_used` text NOT NULL,
	`language_detected` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action
);
