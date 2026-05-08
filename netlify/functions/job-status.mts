import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({
    job_id: job.id,
    status: job.status,
    stage1: {
      status: job.stage1Status,
      result: job.stage1Result,
      error: job.stage1Error,
    },
    stage2: {
      status: job.stage2Status,
      ready: job.stage2Status === "complete",
      error: job.stage2Error,
    },
    panel: {
      claude: { status: job.panelClaudeStatus, error: job.panelClaudeError },
      gpt: { status: job.panelGptStatus, error: job.panelGptError },
      gemini: { status: job.panelGeminiStatus, error: job.panelGeminiError },
    },
  });
};

export const config: Config = {
  path: "/api/job-status",
};
