CREATE TABLE `opencode_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`ticket_id` integer,
	`phase` text NOT NULL,
	`phase_attempt` integer DEFAULT 1,
	`member_id` text,
	`bead_id` text,
	`iteration` integer,
	`state` text DEFAULT 'active' NOT NULL,
	`last_event_id` text,
	`last_event_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `phase_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`phase` text NOT NULL,
	`artifact_type` text,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`icon` text DEFAULT '👤',
	`background` text,
	`main_implementer` text,
	`council_members` text,
	`min_council_quorum` integer DEFAULT 2,
	`per_iteration_timeout` integer DEFAULT 1200000,
	`council_response_timeout` integer DEFAULT 1200000,
	`interview_questions` integer DEFAULT 50,
	`max_iterations` integer DEFAULT 5,
	`disable_analogies` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`shortname` text NOT NULL,
	`icon` text DEFAULT '📁',
	`color` text DEFAULT '#3b82f6',
	`folder_path` text NOT NULL,
	`profile_id` integer,
	`council_members` text,
	`max_iterations` integer,
	`per_iteration_timeout` integer,
	`council_response_timeout` integer,
	`min_council_quorum` integer,
	`interview_questions` integer,
	`ticket_counter` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ticket_status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`reason` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` integer DEFAULT 3,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`xstate_snapshot` text,
	`branch_name` text,
	`current_bead` integer,
	`total_beads` integer,
	`percent_complete` real,
	`error_message` text,
	`locked_main_implementer` text,
	`locked_council_members` text,
	`started_at` text,
	`planned_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_external_id_unique` ON `tickets` (`external_id`);
