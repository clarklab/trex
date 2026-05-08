import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyToken } from "../lib/token.js";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const format = url.searchParams.get("format") || "json";

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  let isPaid = false;
  let tier: "single" | "panel" | null = null;
  if (token) {
    const sessionId = verifyToken(token);
    if (sessionId) {
      const [session] = await db
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, sessionId));
      if (
        session &&
        session.status === "paid" &&
        session.jobId === job.id
      ) {
        isPaid = true;
        tier = (session.tier as "single" | "panel") || "single";
      }
    }
  }

  if (format === "pdf") {
    if (!isPaid) {
      return new Response("Forbidden", { status: 403 });
    }

    const model = url.searchParams.get("model");
    let blobKey: string | null = null;
    let filename = "trec-report.pdf";

    if (tier === "single") {
      blobKey = job.reportBlobKey;
      filename = "trec-report.pdf";
    } else if (tier === "panel") {
      if (model === "claude") {
        blobKey = job.panelClaudeBlobKey;
        filename = "trec-report-claude.pdf";
      } else if (model === "gpt") {
        blobKey = job.panelGptBlobKey;
        filename = "trec-report-gpt.pdf";
      } else if (model === "gemini") {
        blobKey = job.panelGeminiBlobKey;
        filename = "trec-report-gemini.pdf";
      } else {
        return Response.json(
          { error: "Missing or invalid model param (claude|gpt|gemini)" },
          { status: 400 },
        );
      }
    } else {
      return new Response("Forbidden", { status: 403 });
    }

    if (!blobKey) {
      return Response.json(
        { error: "Report not yet generated" },
        { status: 404 },
      );
    }
    const reports = getStore("reports");
    const pdf = await reports.get(blobKey, { type: "arrayBuffer" });
    if (!pdf) {
      return Response.json({ error: "Report missing" }, { status: 404 });
    }
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const response: Record<string, unknown> = {
    job_id: job.id,
    status: job.status,
    paid: isPaid,
    tier,
    stage1: {
      status: job.stage1Status,
      result: job.stage1Result,
      error: job.stage1Error,
    },
  };

  if (isPaid && tier === "single") {
    response.stage2 = {
      status: job.stage2Status,
      result: job.stage2Result,
      error: job.stage2Error,
      pdf_available: !!job.reportBlobKey,
    };
  } else {
    response.stage2 = {
      status: job.stage2Status,
      ready: job.stage2Status === "complete",
    };
  }

  if (isPaid && tier === "panel") {
    response.panel = {
      claude: {
        status: job.panelClaudeStatus,
        result: job.panelClaudeResult,
        error: job.panelClaudeError,
        model: "claude-opus-4-7",
        pdf_available: !!job.panelClaudeBlobKey,
      },
      gpt: {
        status: job.panelGptStatus,
        result: job.panelGptResult,
        error: job.panelGptError,
        model: "gpt-5.5-pro",
        pdf_available: !!job.panelGptBlobKey,
      },
      gemini: {
        status: job.panelGeminiStatus,
        result: job.panelGeminiResult,
        error: job.panelGeminiError,
        model: "gemini-2.5-pro",
        pdf_available: !!job.panelGeminiBlobKey,
      },
    };
  } else {
    response.panel = {
      claude: { status: job.panelClaudeStatus },
      gpt: { status: job.panelGptStatus },
      gemini: { status: job.panelGeminiStatus },
    };
  }

  return Response.json(response);
};

export const config: Config = {
  path: "/api/report",
};
