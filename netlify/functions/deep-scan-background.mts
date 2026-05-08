import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { extractJson } from "../lib/json-extract.js";
import { generateReportPdf, type Stage2Result } from "../lib/report-pdf.js";

const PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract in detail. Return ONLY valid JSON, no prose, no markdown fences.

Compare the contract against the corresponding standard TREC form. Identify EVERY clause that has been modified, added, or removed relative to the standard form.

For each modification, provide:
- "clause": short title for the clause (5-10 words)
- "standard_text": what the standard TREC form says (or "(clause not in standard form)" if added)
- "contract_text": what this contract says (or "(clause removed from standard)" if removed)
- "explanation": plain-English explanation of what changed and what it means for the parties (2-4 sentences)
- "risk": "low", "medium", or "high"
- "questions": array of 1-3 specific questions the user should ask the other party or their attorney

Also include "summary" (2-3 paragraph overall summary of the contract) and "full_terms" (key/value object of all material terms - price, dates, parties, financing, contingencies, etc).

Return this exact JSON structure:
{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "summary": "...",
  "modifications": [
    {
      "clause": "Inspection contingency",
      "standard_text": "...",
      "contract_text": "...",
      "explanation": "...",
      "risk": "high",
      "questions": ["...", "..."]
    }
  ],
  "full_terms": {
    "price": "$350,000",
    "earnest_money": "$5,000",
    "option_period_days": "10",
    "closing_date": "2025-03-15",
    "buyer": "Jane Doe",
    "seller": "John Smith",
    "financing_type": "Conventional"
  }
}

Contract text:
---
{PDF_TEXT}
---`;

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
      console.error(`deep-scan: job ${jobId} not found`);
      return new Response("Job not found", { status: 404 });
    }
    if (job.status !== "processing") {
      console.log(`deep-scan: job ${jobId} not processing (${job.status})`);
      return new Response("ok", { status: 200 });
    }

    await db
      .update(jobs)
      .set({ stage2Status: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const text = await extractPdfText(jobId, job.blobKey);
    const prompt = PROMPT.replace("{PDF_TEXT}", text);

    const anthropic = new Anthropic({ timeout: 600_000 });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = extractJson<Stage2Result>(firstBlock.text);

    const reportPdf = await generateReportPdf(
      (job.stage1Result as Record<string, unknown>) || null,
      result,
    );
    const reportBlobKey = `${jobId}/full-report.pdf`;
    const reports = getStore("reports");
    const pdfArrayBuf = reportPdf.buffer.slice(
      reportPdf.byteOffset,
      reportPdf.byteOffset + reportPdf.byteLength,
    ) as ArrayBuffer;
    await reports.set(reportBlobKey, pdfArrayBuf);

    await db
      .update(jobs)
      .set({
        stage2Status: "complete",
        stage2Result: result,
        reportBlobKey,
        status: "complete",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`deep-scan ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        stage2Status: "error",
        stage2Error: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
