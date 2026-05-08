import type { Config, Context } from "@netlify/functions";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { db } from "../../db/index.js";
import { checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { fanOutForTier, type Tier } from "../lib/fanout.js";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Netlify.env.get("POLAR_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response("Polar webhook not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });

  let event: { type: string; data: unknown };
  try {
    event = validateEvent(rawBody, headers, webhookSecret) as typeof event;
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response("Invalid signature", { status: 403 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Polar webhook verify failed:", msg);
    return new Response(`Webhook verify failed: ${msg}`, { status: 400 });
  }

  if (event.type === "order.paid") {
    const order = event.data as {
      metadata?: Record<string, string>;
      checkout_id?: string;
      checkoutId?: string;
    };
    const sessionId = order.metadata?.session_id;
    if (!sessionId) {
      console.warn("order.paid without session_id metadata");
      return new Response("ok");
    }

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId));

    if (!session) {
      console.warn(`Polar webhook for unknown session ${sessionId}`);
      return new Response("ok");
    }

    if (session.status !== "paid") {
      await db
        .update(checkoutSessions)
        .set({
          status: "paid",
          method: "polar",
          paidAt: new Date(),
        })
        .where(eq(checkoutSessions.id, sessionId));

      const reqOrigin = (() => {
        try { return new URL(req.url).origin; } catch { return ""; }
      })();
      fanOutForTier(session.tier as Tier, session.jobId, context, reqOrigin);
    }
  }

  return new Response("ok");
};

export const config: Config = {
  path: "/api/polar-webhook",
};
