import { pgTable, text, timestamp, integer, bigint, jsonb, uuid, boolean, date } from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").notNull().default("uploading"),

  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  blobKey: text("blob_key"),

  stage1Status: text("stage1_status").notNull().default("pending"),
  stage1Result: jsonb("stage1_result"),
  stage1Error: text("stage1_error"),

  stage2Status: text("stage2_status").notNull().default("pending"),
  stage2Result: jsonb("stage2_result"),
  stage2Error: text("stage2_error"),
  reportBlobKey: text("report_blob_key"),

  panelClaudeStatus: text("panel_claude_status").notNull().default("pending"),
  panelClaudeResult: jsonb("panel_claude_result"),
  panelClaudeError: text("panel_claude_error"),
  panelClaudeBlobKey: text("panel_claude_blob_key"),

  panelGptStatus: text("panel_gpt_status").notNull().default("pending"),
  panelGptResult: jsonb("panel_gpt_result"),
  panelGptError: text("panel_gpt_error"),
  panelGptBlobKey: text("panel_gpt_blob_key"),

  panelGeminiStatus: text("panel_gemini_status").notNull().default("pending"),
  panelGeminiResult: jsonb("panel_gemini_result"),
  panelGeminiError: text("panel_gemini_error"),
  panelGeminiBlobKey: text("panel_gemini_blob_key"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),

  tier: text("tier").notNull().default("single"),

  status: text("status").notNull().default("pending"),
  method: text("method"),

  polarCheckoutId: text("polar_checkout_id"),
  recoveryCode: text("recovery_code").unique(),
  lnPaymentHash: text("ln_payment_hash"),
  lnVerifyUrl: text("ln_verify_url"),

  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Anonymized per-contract stats. Captured automatically when quick-scan
// finishes (and refined when deep-scan + payment land). Designed to be safe
// to expose publicly via /api/stats — no party names, no street addresses,
// no clause text. Money in cents to keep aggregations exact.
export const contractStats = pgTable("contract_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),

  // Form identification
  formId: text("form_id"),
  formName: text("form_name"),
  pageCount: integer("page_count"),
  confidence: integer("confidence"),
  formStatus: text("form_status"),

  // Money (cents)
  salesPriceCents: bigint("sales_price_cents", { mode: "number" }),
  earnestMoneyCents: bigint("earnest_money_cents", { mode: "number" }),
  optionFeeCents: bigint("option_fee_cents", { mode: "number" }),
  optionPeriodDays: integer("option_period_days"),
  downPaymentCents: bigint("down_payment_cents", { mode: "number" }),
  financingAmountCents: bigint("financing_amount_cents", { mode: "number" }),
  financingType: text("financing_type"),

  // Geographic — city/state/zip only, never the street address
  propertyCity: text("property_city"),
  propertyState: text("property_state"),
  propertyZip: text("property_zip"),

  // Timing
  effectiveDate: date("effective_date"),
  closingDate: date("closing_date"),
  closingDaysOut: integer("closing_days_out"),

  // Risk profile
  modificationCount: integer("modification_count"),
  severityHigh: integer("severity_high"),
  severityMedium: integer("severity_medium"),
  severityLow: integer("severity_low"),

  // Tier / payment
  tier: text("tier"),
  paid: boolean("paid").notNull().default(false),

  fileSizeBytes: integer("file_size_bytes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type NewCheckoutSession = typeof checkoutSessions.$inferInsert;
export type ContractStats = typeof contractStats.$inferSelect;
export type NewContractStats = typeof contractStats.$inferInsert;
