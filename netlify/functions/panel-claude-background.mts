import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { buildDeepPrompt, parseDeepResult } from "../lib/deep-prompt.js";

const MODEL = "claude-opus-4-7";

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
      .set({ panelClaudeStatus: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const text = await extractPdfText(jobId, job.blobKey);
    const prompt = buildDeepPrompt(text);

    const anthropic = new Anthropic({ timeout: 600_000 });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = parseDeepResult(firstBlock.text);

    await db
      .update(jobs)
      .set({
        panelClaudeStatus: "complete",
        panelClaudeResult: result,
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
