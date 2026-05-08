import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { loadPdfBase64 } from "../lib/pdf-blob.js";
import { extractJson } from "../lib/json-extract.js";

const PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract PDF that is attached above. Read the PDF directly — including any handwritten or typed entries, signatures, and stamps. Return ONLY valid JSON, no prose, no markdown fences.

Identify which TREC standard form this contract is based on:
- 20-18: One to Four Family Residential Contract (Resale)
- 30-17: Residential Condominium Contract (Resale)
- 24-19: New Home Contract (Completed Construction)
- 23-19: New Home Contract (Incomplete Construction)
- 25-15: Farm and Ranch Contract
- 9-16: Unimproved Property Contract
- OP-H: Seller's Disclosure Notice
- 40-11: Third Party Financing Addendum

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
- "confidence" is an integer 0-100 reflecting how confident you are about the form match. If you cannot identify the form, use the closest match with a low confidence score, not "Unknown".
- "modification_count" is an integer estimating how many clauses deviate from the standard form. 0 if it appears to be a fresh blank form.
- "red_flags" is an array of exactly 3 short titles (5-10 words each) describing potential issues. Examples: "Option period under 5 days", "As-is clause without inspection contingency", "Blank earnest money amount". If the contract looks clean, use educational notes like "Verify financing approval deadline" or "Review special provisions paragraph 11".
- For "terms", extract from filled-in blanks. Use null if a field is genuinely blank in the contract.
- "option_period_days" is a number or null.
- All other "terms" fields are strings or null.
- Do NOT report "no contract text provided" or similar — you have the PDF document attached above. Read it.`;

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

    const { base64, byteLength } = await loadPdfBase64(job.blobKey);
    console.log(
      `quick-scan ${jobId}: loaded PDF (${byteLength} bytes), calling Haiku with document attachment`,
    );

    const anthropic = new Anthropic({ timeout: 120_000 });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = extractJson<Stage1Result>(firstBlock.text);
    console.log(
      `quick-scan ${jobId}: identified ${result.form_id} at ${result.confidence}%, ${result.modification_count} mods, ${result.red_flags?.length ?? 0} flags`,
    );

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
