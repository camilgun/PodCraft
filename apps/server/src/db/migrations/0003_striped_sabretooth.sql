PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_analysis_results` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`summary` text NOT NULL,
	`suggested_title` text NOT NULL,
	`chapters` text NOT NULL,
	`editorial_notes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_analysis_results`("id", "recording_id", "summary", "suggested_title", "chapters", "editorial_notes", "created_at") SELECT "id", "recording_id", "summary", "suggested_title", "chapters", "editorial_notes", "created_at" FROM `analysis_results`;--> statement-breakpoint
DROP TABLE `analysis_results`;--> statement-breakpoint
ALTER TABLE `__new_analysis_results` RENAME TO `analysis_results`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_edit_proposals` (
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
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`analysis_result_id`) REFERENCES `analysis_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_edit_proposals`("id", "recording_id", "analysis_result_id", "type", "subtype", "start_time", "end_time", "original_text", "reason", "confidence", "proposed_position", "status", "user_start_time", "user_end_time", "created_at", "updated_at") SELECT "id", "recording_id", "analysis_result_id", "type", "subtype", "start_time", "end_time", "original_text", "reason", "confidence", "proposed_position", "status", "user_start_time", "user_end_time", "created_at", "updated_at" FROM `edit_proposals`;--> statement-breakpoint
DROP TABLE `edit_proposals`;--> statement-breakpoint
ALTER TABLE `__new_edit_proposals` RENAME TO `edit_proposals`;--> statement-breakpoint
CREATE TABLE `__new_quality_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`window_start` real NOT NULL,
	`window_end` real NOT NULL,
	`mos` real NOT NULL,
	`noisiness` real NOT NULL,
	`discontinuity` real NOT NULL,
	`coloration` real NOT NULL,
	`loudness` real NOT NULL,
	`flagged` integer DEFAULT false NOT NULL,
	`flagged_by` text DEFAULT 'auto' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_quality_scores`("id", "recording_id", "window_start", "window_end", "mos", "noisiness", "discontinuity", "coloration", "loudness", "flagged", "flagged_by", "created_at") SELECT "id", "recording_id", "window_start", "window_end", "mos", "noisiness", "discontinuity", "coloration", "loudness", "flagged", "flagged_by", "created_at" FROM `quality_scores`;--> statement-breakpoint
DROP TABLE `quality_scores`;--> statement-breakpoint
ALTER TABLE `__new_quality_scores` RENAME TO `quality_scores`;--> statement-breakpoint
CREATE TABLE `__new_transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`full_text` text NOT NULL,
	`segments` text NOT NULL,
	`model_used` text NOT NULL,
	`language_detected` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_transcriptions`("id", "recording_id", "full_text", "segments", "model_used", "language_detected", "created_at") SELECT "id", "recording_id", "full_text", "segments", "model_used", "language_detected", "created_at" FROM `transcriptions`;--> statement-breakpoint
DROP TABLE `transcriptions`;--> statement-breakpoint
ALTER TABLE `__new_transcriptions` RENAME TO `transcriptions`;