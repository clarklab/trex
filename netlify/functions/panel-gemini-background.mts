import type { Config, Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractPdfText } from "../lib/pdf.js";
import { buildDeepPrompt, parseDeepResult } from "../lib/deep-prompt.js";

const MODEL = "gemini-2.5-pro";

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
      .set({ panelGeminiStatus: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const text = await extractPdfText(jobId, job.blobKey);
    const prompt = buildDeepPrompt(text);

    const genAI = new GoogleGenAI({});
    const response = await genAI.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const responseText =
      typeof response.text === "string"
        ? response.text
        : (response.text as unknown as () => string)?.();
    if (!responseText) throw new Error("Gemini response had no text");
    const result = parseDeepResult(responseText);

    await db
      .update(jobs)
      .set({
        panelGeminiStatus: "complete",
        panelGeminiResult: result,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`panel-gemini ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        panelGeminiStatus: "error",
        panelGeminiError: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
