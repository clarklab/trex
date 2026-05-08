import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/token.js";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return Response.json({ error: "Missing session_id" }, { status: 400 });
  }

  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return Response.json({ status: "not_found" }, { status: 404 });
  }

  if (session.status === "paid") {
    return Response.json({
      status: "paid",
      method: session.method,
      job_id: session.jobId,
      download_token: signToken(sessionId),
    });
  }

  if (session.lnVerifyUrl) {
    try {
      const v = await fetch(session.lnVerifyUrl);
      if (v.ok) {
        const data = (await v.json()) as { settled?: boolean };
        if (data.settled === true) {
          await db
            .update(checkoutSessions)
            .set({
              status: "paid",
              method: "lightning",
              paidAt: new Date(),
            })
            .where(eq(checkoutSessions.id, sessionId));
          return Response.json({
            status: "paid",
            method: "lightning",
            job_id: session.jobId,
            download_token: signToken(sessionId),
          });
        }
      }
    } catch (err) {
      console.warn(`LN verify check failed for ${sessionId}:`, err);
    }
  }

  return Response.json({ status: "pending" });
};

export const config: Config = {
  path: "/api/checkout-status",
};
