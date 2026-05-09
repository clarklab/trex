import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/token.js";
import { isValidRecoveryCode } from "../lib/recovery-code.js";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    const code = segs[segs.length - 1];

    if (!isValidRecoveryCode(code)) {
      return Response.json({ error: "Invalid code" }, { status: 400 });
    }

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.recoveryCode, code));
    if (!session) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, session.jobId));
    if (!job) {
      return Response.json({ error: "Job missing" }, { status: 404 });
    }

    const paid = session.status === "paid";
    const downloadToken = paid ? signToken(session.id) : null;

    const response: Record<string, unknown> = {
      code,
      job_id: job.id,
      session_id: session.id,
      tier: session.tier,
      paid,
      method: session.method,
      paid_at: session.paidAt,
      created_at: session.createdAt,
      download_token: downloadToken,
      stage1: {
        status: job.stage1Status,
        result: job.stage1Result,
        error: job.stage1Error,
      },
    };

    if (paid && session.tier === "single") {
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

    if (paid && session.tier === "panel") {
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

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/r/:code failed:", msg);
    return Response.json(
      { error: "Server error", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/r/:code",
};
