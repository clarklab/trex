ALTER TABLE "checkout_sessions" ADD COLUMN "recovery_code" text;
CREATE UNIQUE INDEX "checkout_sessions_recovery_code_idx"
  ON "checkout_sessions" ("recovery_code");
