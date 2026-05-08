import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/token.js";
import { fanOutForTier, type Tier } from "../lib/fanout.js";

function isTier(t: unknown): t is Tier {
  return t === "single" || t === "panel";
}

function expectedCode(): string {
  return (Netlify.env.get("COUPON_CODE") || "FREE").trim().toUpperCase();
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    let body: { job_id?: string; tier?: string; code?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const jobId = body.job_id;
    if (!jobId) {
      return Response.json({ error: "Missing job_id" }, { status: 400 });
    }
    const tier: Tier = isTier(body.tier) ? body.tier : "single";
    const code = (body.code || "").trim().toUpperCase();
    if (!code) {
      return Response.json({ error: "Missing code" }, { status: 400 });
    }
    if (code !== expectedCode()) {
      return Response.json({ error: "Invalid code" }, { status: 400 });
    }

    console.log(`redeem-coupon: validating job ${jobId} tier=${tier}`);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    const [session] = await db
      .insert(checkoutSessions)
      .values({
        jobId,
        tier,
        status: "paid",
        method: "coupon",
        paidAt: new Date(),
      })
      .returning();

    console.log(`redeem-coupon: session ${session.id} created for job ${jobId}`);

    const reqOrigin = (() => {
      try { return new URL(req.url).origin; } catch { return ""; }
    })();
    fanOutForTier(tier, jobId, context, reqOrigin);

    return Response.json({
      status: "paid",
      method: "coupon",
      tier,
      job_id: jobId,
      session_id: session.id,
      download_token: signToken(session.id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`redeem-coupon failed: ${msg}`);
    if (stack) console.error(stack);
    return Response.json(
      { error: "Server error", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/redeem-coupon",
};
