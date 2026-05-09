import type { Config, Context } from "@netlify/functions";
import { Polar } from "@polar-sh/sdk";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import type { Tier } from "../lib/fanout.js";
import { generateRecoveryCode } from "../lib/recovery-code.js";

const TIER_PRICES: Record<Tier, number> = {
  single: 5,
  panel: 12,
};

function isTier(t: unknown): t is Tier {
  return t === "single" || t === "panel";
}

function polarServerEnv(): "sandbox" | "production" {
  const v = Netlify.env.get("POLAR_SERVER");
  return v === "production" ? "production" : "sandbox";
}

function productIdForTier(tier: Tier): string | null {
  return tier === "panel"
    ? Netlify.env.get("POLAR_PRODUCT_PANEL") ?? null
    : Netlify.env.get("POLAR_PRODUCT_SINGLE") ?? null;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const polarToken = Netlify.env.get("POLAR_ACCESS_TOKEN");
  if (!polarToken) {
    return Response.json({ error: "Polar not configured" }, { status: 500 });
  }
  const lnAvailable = !!Netlify.env.get("ALBY_LN_ADDRESS");

  let body: { job_id?: string; tier?: string };
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
  const priceUsd = TIER_PRICES[tier];

  const productId = productIdForTier(tier);
  if (!productId) {
    return Response.json(
      { error: `Polar product id missing for tier ${tier}` },
      { status: 500 },
    );
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const polar = new Polar({
    accessToken: polarToken,
    server: polarServerEnv(),
  });

  const recoveryCode = generateRecoveryCode();
  const [session] = await db
    .insert(checkoutSessions)
    .values({
      jobId,
      tier,
      status: "pending",
      recoveryCode,
    })
    .returning();

  const origin = (() => {
    try { return new URL(req.url).origin; } catch { return ""; }
  })();
  const successUrl = origin
    ? `${origin}/r/${recoveryCode}?paid=1`
    : undefined;

  const polarCheckout = await polar.checkouts.create({
    products: [productId],
    successUrl,
    metadata: { session_id: session.id, job_id: jobId, tier },
  });

  await db
    .update(checkoutSessions)
    .set({ polarCheckoutId: polarCheckout.id })
    .where(eq(checkoutSessions.id, session.id));

  // LN invoice is fetched lazily by /api/checkout-ln-invoice when (and if)
  // the user clicks the Lightning tab. Keeps the dialog snappy for the
  // common card path.

  return Response.json({
    session_id: session.id,
    tier,
    price_usd: priceUsd,
    polar_checkout_id: polarCheckout.id,
    polar_checkout_url: polarCheckout.url,
    ln_available: lnAvailable,
    recovery_code: recoveryCode,
  });
};

export const config: Config = {
  path: "/api/checkout-init",
};
