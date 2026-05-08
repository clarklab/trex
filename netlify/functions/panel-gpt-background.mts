import type { Config, Context } from "@netlify/functions";
import OpenAI from "openai";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { buildDeepPrompt, parseDeepResult } from "../lib/deep-prompt.js";

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

    const text = await extractPdfText(jobId, job.blobKey);
    const formId = (job.stage1Result as { form_id?: string } | null)?.form_id ?? null;
    const prompt = buildDeepPrompt(text, formId);

    const openai = new OpenAI({ timeout: 600_000 });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI response had no content");
    const result = parseDeepResult(content);

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
