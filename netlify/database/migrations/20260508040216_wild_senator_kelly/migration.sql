CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"stripe_intent_id" text,
	"ln_payment_hash" text,
	"ln_verify_url" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" text DEFAULT 'uploading' NOT NULL,
	"filename" text NOT NULL,
	"file_size" integer NOT NULL,
	"blob_key" text,
	"stage1_status" text DEFAULT 'pending' NOT NULL,
	"stage1_result" jsonb,
	"stage1_error" text,
	"stage2_status" text DEFAULT 'pending' NOT NULL,
	"stage2_result" jsonb,
	"stage2_error" text,
	"report_blob_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");