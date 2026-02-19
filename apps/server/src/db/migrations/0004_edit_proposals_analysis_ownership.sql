PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_edit_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_result_id` text NOT NULL,
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
	FOREIGN KEY (`analysis_result_id`) REFERENCES `analysis_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_edit_proposals`("id", "analysis_result_id", "type", "subtype", "start_time", "end_time", "original_text", "reason", "confidence", "proposed_position", "status", "user_start_time", "user_end_time", "created_at", "updated_at") SELECT "id", "analysis_result_id", "type", "subtype", "start_time", "end_time", "original_text", "reason", "confidence", "proposed_position", "status", "user_start_time", "user_end_time", "created_at", "updated_at" FROM `edit_proposals`;--> statement-breakpoint
DROP TABLE `edit_proposals`;--> statement-breakpoint
ALTER TABLE `__new_edit_proposals` RENAME TO `edit_proposals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;