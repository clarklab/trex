import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { fetchLnurlInvoice, usdToSats } from "../lib/lightning.js";
import type { Tier } from "../lib/fanout.js";

const TIER_PRICES: Record<Tier, number> = {
  single: 5,
  panel: 12,
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const lnAddress = Netlify.env.get("ALBY_LN_ADDRESS");
  if (!lnAddress) {
    return Response.json({ error: "Lightning not configured" }, { status: 503 });
  }

  let body: { session_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = body.session_id;
  if (!sessionId) {
    return Response.json({ error: "Missing session_id" }, { status: 400 });
  }

  try {
    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId));
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const tier = (session.tier as Tier) || "single";
    const priceUsd = TIER_PRICES[tier] ?? 5;

    const sats = await usdToSats(priceUsd);
    const inv = await fetchLnurlInvoice(lnAddress, sats);

    await db
      .update(checkoutSessions)
      .set({
        lnPaymentHash: inv.payment_hash ?? null,
        lnVerifyUrl: inv.verify ?? null,
      })
      .where(eq(checkoutSessions.id, sessionId));

    return Response.json({
      session_id: sessionId,
      ln_invoice: inv.pr,
      ln_amount_sats: sats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`checkout-ln-invoice failed: ${msg}`);
    return Response.json(
      { error: "Failed to generate Lightning invoice", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/checkout-ln-invoice",
};
