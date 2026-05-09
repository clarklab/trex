// netlify/functions/retry.mts
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { isValidRecoveryCode } from "../lib/recovery-code.js";
import { fanOutForTier, type Tier } from "../lib/fanout.js";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { recovery_code?: string };
  try { body = await req.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.recovery_code;
  if (!isValidRecoveryCode(code)) {
    return Response.json({ error: "Invalid code" }, { status: 400 });
  }

  try {
    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.recoveryCode, code));
    if (!session) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (session.status !== "paid") {
      return Response.json({ error: "Session not paid" }, { status: 403 });
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, session.jobId));
    if (!job) {
      return Response.json({ error: "Job missing" }, { status: 404 });
    }

    const tier = session.tier as Tier;
    const reset: Record<string, unknown> = { updatedAt: new Date() };

    if (tier === "single") {
      // Only retry if stage2 actually failed (don't clobber a completed report)
      if (job.stage2Status !== "complete") {
        reset.stage2Status = "pending";
        reset.stage2Error = null;
      }
    } else if (tier === "panel") {
      if (job.panelClaudeStatus !== "complete") {
        reset.panelClaudeStatus = "pending";
        reset.panelClaudeError = null;
      }
      if (job.panelGptStatus !== "complete") {
        reset.panelGptStatus = "pending";
        reset.panelGptError = null;
      }
      if (job.panelGeminiStatus !== "complete") {
        reset.panelGeminiStatus = "pending";
        reset.panelGeminiError = null;
      }
    }

    // Also reset job.status if it was "complete" with errors. The background
    // functions check job.status === "processing" — only reset to processing
    // if it isn't already, to avoid stomping on in-flight work.
    if (job.status !== "processing") {
      reset.status = "processing";
    }

    if (Object.keys(reset).length > 1) {
      await db.update(jobs).set(reset).where(eq(jobs.id, job.id));
    }

    const reqOrigin = (() => {
      try { return new URL(req.url).origin; } catch { return ""; }
    })();
    fanOutForTier(tier, job.id, context, reqOrigin);

    console.log(`retry: re-triggered ${tier} fan-out for job ${job.id}`);
    return Response.json({ status: "retrying", tier, job_id: job.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/retry failed:", msg);
    return Response.json({ error: "Server error", detail: msg }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/retry",
};
