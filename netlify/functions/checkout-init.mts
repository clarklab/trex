import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { fetchLnurlInvoice, usdToSats } from "../lib/lightning.js";

const PRICE_USD = 5;
const PRICE_CENTS = PRICE_USD * 100;

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return Response.json({ error: "Stripe not configured" }, { status: 500 });
  }
  const lnAddress = Netlify.env.get("ALBY_LN_ADDRESS");

  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.job_id;
  if (!jobId) {
    return Response.json({ error: "Missing job_id" }, { status: 400 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const stripe = new Stripe(stripeKey);

  const [session] = await db
    .insert(checkoutSessions)
    .values({
      jobId,
      status: "pending",
    })
    .returning();

  const intent = await stripe.paymentIntents.create({
    amount: PRICE_CENTS,
    currency: "usd",
    metadata: { session_id: session.id, job_id: jobId },
    automatic_payment_methods: { enabled: true },
  });

  let lnInvoice: string | null = null;
  let lnAmountSats: number | null = null;
  let lnVerifyUrl: string | null = null;
  let lnPaymentHash: string | null = null;

  if (lnAddress) {
    try {
      const sats = await usdToSats(PRICE_USD);
      const inv = await fetchLnurlInvoice(lnAddress, sats);
      lnInvoice = inv.pr;
      lnAmountSats = sats;
      lnVerifyUrl = inv.verify ?? null;
      lnPaymentHash = inv.payment_hash ?? null;
    } catch (err) {
      console.warn("LN invoice creation failed:", err);
    }
  }

  await db
    .update(checkoutSessions)
    .set({
      stripeIntentId: intent.id,
      lnPaymentHash,
      lnVerifyUrl,
    })
    .where(eq(checkoutSessions.id, session.id));

  return Response.json({
    session_id: session.id,
    stripe_client_secret: intent.client_secret,
    stripe_publishable_key: Netlify.env.get("STRIPE_PUBLISHABLE_KEY") ?? null,
    ln_invoice: lnInvoice,
    ln_amount_sats: lnAmountSats,
    ln_available: lnInvoice !== null,
  });
};

export const config: Config = {
  path: "/api/checkout-init",
};
