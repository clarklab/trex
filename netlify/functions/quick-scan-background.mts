import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { extractJson } from "../lib/json-extract.js";

const PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract. Return ONLY valid JSON, no prose, no markdown fences.

Identify which TREC standard form this contract is based on:
- 20-18: One to Four Family Residential Contract (Resale)
- 23-19: Residential Condominium Contract (Resale)
- 24-19: Farm and Ranch Contract
- 25-13: Unimproved Property Contract
- 30-17: Residential Contract (New Home, Incomplete Construction)
- 9-17: Residential Contract (New Home, Completed Construction)

Return this exact JSON structure:
{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "confidence": 92,
  "modification_count": 7,
  "red_flags": ["Title 1", "Title 2", "Title 3"],
  "terms": {
    "price": "$350,000",
    "option_period_days": 10,
    "closing_date": "2025-03-15",
    "buyer": "Jane Doe",
    "seller": "John Smith",
    "financing_type": "Conventional"
  }
}

Rules:
- "confidence" is an integer 0-100 reflecting how confident you are about the form match.
- "modification_count" is an integer estimating how many clauses deviate from the standard form.
- "red_flags" is an array of exactly 3 short titles (5-10 words each).
- For "terms", use null if a field is not present in the contract.
- Use string values for all "terms" fields except option_period_days which is a number or null.

Contract text:
---
{PDF_TEXT}
---`;

interface Stage1Result {
  form_id: string;
  form_name: string;
  confidence: number;
  modification_count: number;
  red_flags: string[];
  terms: {
    price: string | null;
    option_period_days: number | null;
    closing_date: string | null;
    buyer: string | null;
    seller: string | null;
    financing_type: string | null;
  };
}

export default async (req: Request, _context: Context) => {
  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const jobId = body.job_id;
  if (!jobId) {
    return new Response("Missing job_id", { status: 400 });
  }

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job || !job.blobKey) {
      console.error(`quick-scan: job ${jobId} not found or no blob key`);
      return new Response("Job not found", { status: 404 });
    }
    if (job.status !== "processing") {
      console.log(`quick-scan: job ${jobId} not processing (${job.status}), exiting`);
      return new Response("ok", { status: 200 });
    }

    await db
      .update(jobs)
      .set({ stage1Status: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const text = await extractPdfText(jobId, job.blobKey);
    const prompt = PROMPT.replace("{PDF_TEXT}", text);

    const anthropic = new Anthropic({ timeout: 120_000 });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = extractJson<Stage1Result>(firstBlock.text);

    await db
      .update(jobs)
      .set({
        stage1Status: "complete",
        stage1Result: result,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`quick-scan ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        stage1Status: "error",
        stage1Error: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
