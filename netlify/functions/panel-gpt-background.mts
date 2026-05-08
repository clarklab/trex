import type { Config, Context } from "@netlify/functions";
import OpenAI from "openai";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { loadPdfBase64 } from "../lib/pdf-blob.js";
import { buildDeepPromptForAttachment, parseDeepResult } from "../lib/deep-prompt.js";

const MODEL = "gpt-5.5-pro";

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

    await db
      .update(jobs)
      .set({
        panelGptStatus: "complete",
        panelGptResult: result,
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
