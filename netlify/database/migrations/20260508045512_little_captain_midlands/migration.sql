ALTER TABLE "checkout_sessions" ADD COLUMN "tier" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_claude_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_claude_result" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_claude_error" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gpt_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gpt_result" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gpt_error" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gemini_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gemini_result" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "panel_gemini_error" text;