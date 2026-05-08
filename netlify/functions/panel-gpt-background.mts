import type { Config, Context } from "@netlify/functions";
import OpenAI from "openai";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { loadPdfBase64 } from "../lib/pdf-blob.js";
import { buildDeepPromptForAttachment, parseDeepResult } from "../lib/deep-prompt.js";
import { generateReportPdf } from "../lib/report-pdf.js";

const MODEL = "gpt-5.5-pro";
const MODEL_LABEL = "GPT-5.5 Pro";

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
    if (job.panelGptStatus !== "pending") {
      console.log(
        `panel-gpt ${jobId}: already ${job.panelGptStatus}, skipping duplicate`,
      );
      return new Response("ok", { status: 200 });
    }

    await db
      .update(jobs)
      .set({ panelGptStatus: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const formId = (job.stage1Result as { form_id?: string } | null)?.form_id ?? null;
    const { base64 } = await loadPdfBase64(job.blobKey);
    const prompt = buildDeepPromptForAttachment(formId);

    const openai = new OpenAI({ timeout: 600_000 });
    const response = await openai.responses.create({
      model: MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "contract.pdf",
              file_data: `data:application/pdf;base64,${base64}`,
            },
            { type: "input_text", text: prompt },
          ],
        },
      ],
    });

    const text = response.output_text;
    if (!text) throw new Error("OpenAI response had no output_text");
    const result = parseDeepResult(text);

    const reportPdf = await generateReportPdf(
      (job.stage1Result as Record<string, unknown>) || null,
      result,
      { modelLabel: MODEL_LABEL },
    );
    const blobKey = `${jobId}/panel-gpt.pdf`;
    const reports = getStore("reports");
    const pdfArrayBuf = reportPdf.buffer.slice(
      reportPdf.byteOffset,
      reportPdf.byteOffset + reportPdf.byteLength,
    ) as ArrayBuffer;
    await reports.set(blobKey, pdfArrayBuf);

    await db
      .update(jobs)
      .set({
        panelGptStatus: "complete",
        panelGptResult: result,
        panelGptBlobKey: blobKey,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`panel-gpt ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        panelGptStatus: "error",
        panelGptError: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
