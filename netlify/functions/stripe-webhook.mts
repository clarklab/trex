import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { db } from "../../db/index.js";
import { checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(stripeKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Stripe signature verify failed:", msg);
    return new Response(`Webhook signature failed: ${msg}`, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const sessionId = intent.metadata?.session_id;
    if (!sessionId) {
      console.warn("payment_intent.succeeded without session_id metadata");
      return new Response("ok");
    }

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId));

    if (!session) {
      console.warn(`Webhook for unknown session ${sessionId}`);
      return new Response("ok");
    }

    if (session.status !== "paid") {
      await db
        .update(checkoutSessions)
        .set({
          status: "paid",
          method: "card",
          paidAt: new Date(),
        })
        .where(eq(checkoutSessions.id, sessionId));
    }
  }

  return new Response("ok");
};

export const config: Config = {
  path: "/api/stripe-webhook",
};
