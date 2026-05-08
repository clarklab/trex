import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { loadPdfBase64 } from "../lib/pdf-blob.js";
import { buildDeepPromptForAttachment, parseDeepResult } from "../lib/deep-prompt.js";
import { generateReportPdf } from "../lib/report-pdf.js";

const MODEL = "claude-opus-4-7";
const MODEL_LABEL = "Claude Opus 4.7";

export default async (req: Request, _context: Context) => {
  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const jobId = body.job_id;
  if (!jobId) return new Response("Missing job_id", { status: 400 });

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job || !job.blobKey) {
      return new Response("Job not found", { status: 404 });
    }
    if (job.panelClaudeStatus !== "pending") {
      console.log(
        `panel-claude ${jobId}: already ${job.panelClaudeStatus}, skipping duplicate`,
      );
      return new Response("ok", { status: 200 });
    }

    await db
      .update(jobs)
      .set({ panelClaudeStatus: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const formId = (job.stage1Result as { form_id?: string } | null)?.form_id ?? null;
    const { base64 } = await loadPdfBase64(job.blobKey);
    const prompt = buildDeepPromptForAttachment(formId);

    const anthropic = new Anthropic({ timeout: 600_000 });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
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
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = parseDeepResult(firstBlock.text);

    const reportPdf = await generateReportPdf(
      (job.stage1Result as Record<string, unknown>) || null,
      result,
      { modelLabel: MODEL_LABEL },
    );
    const blobKey = `${jobId}/panel-claude.pdf`;
    const reports = getStore("reports");
    const pdfArrayBuf = reportPdf.buffer.slice(
      reportPdf.byteOffset,
      reportPdf.byteOffset + reportPdf.byteLength,
    ) as ArrayBuffer;
    await reports.set(blobKey, pdfArrayBuf);

    await db
      .update(jobs)
      .set({
        panelClaudeStatus: "complete",
        panelClaudeResult: result,
        panelClaudeBlobKey: blobKey,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`panel-claude ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        panelClaudeStatus: "error",
        panelClaudeError: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
