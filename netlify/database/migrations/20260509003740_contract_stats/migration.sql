CREATE TABLE "contract_stats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "jobs"("id"),

  "form_id" text,
  "form_name" text,
  "page_count" integer,
  "confidence" integer,
  "form_status" text,

  "sales_price_cents" bigint,
  "earnest_money_cents" bigint,
  "option_fee_cents" bigint,
  "option_period_days" integer,
  "down_payment_cents" bigint,
  "financing_amount_cents" bigint,
  "financing_type" text,

  "property_city" text,
  "property_state" text,
  "property_zip" text,

  "effective_date" date,
  "closing_date" date,
  "closing_days_out" integer,

  "modification_count" integer,
  "severity_high" integer,
  "severity_medium" integer,
  "severity_low" integer,

  "tier" text,
  "paid" boolean NOT NULL DEFAULT false,

  "file_size_bytes" integer,

  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "contract_stats_job_id_idx" ON "contract_stats" ("job_id");
CREATE INDEX "contract_stats_created_at_idx" ON "contract_stats" ("created_at");
CREATE INDEX "contract_stats_form_id_idx" ON "contract_stats" ("form_id");
CREATE INDEX "contract_stats_paid_idx" ON "contract_stats" ("paid");
