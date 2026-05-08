import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { buildDeepPrompt, parseDeepResult } from "../lib/deep-prompt.js";
import { generateReportPdf } from "../lib/report-pdf.js";

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
    const formId = (job.stage1Result as { form_id?: string } | null)?.form_id ?? null;
    const prompt = buildDeepPrompt(text, formId);

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
    const result = parseDeepResult(firstBlock.text);

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
