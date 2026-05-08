import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";

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

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),

  status: text("status").notNull().default("pending"),
  method: text("method"),

  stripeIntentId: text("stripe_intent_id"),
  lnPaymentHash: text("ln_payment_hash"),
  lnVerifyUrl: text("ln_verify_url"),

  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type NewCheckoutSession = typeof checkoutSessions.$inferInsert;
