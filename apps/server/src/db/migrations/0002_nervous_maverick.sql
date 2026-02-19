CREATE UNIQUE INDEX `recordings_file_path_unique` ON `recordings` (`file_path`);--> statement-breakpoint
CREATE INDEX `recordings_file_hash_idx` ON `recordings` (`file_hash`);