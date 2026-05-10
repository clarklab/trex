import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { landerViews } from "../../db/schema.js";

// Beacon endpoint hit on every lander page load. Insert-only, no auth.
// Bots will inflate this — that's fine, the /landers dashboard uses these
// numbers for relative comparison between landers, not absolute truth.
//
// The beacon sends `path` (e.g. "/forms/20-18") in the body. We validate
// against an allowlist so a flooder can't spam arbitrary strings into
// the table.

const ALLOWED_PATHS = new Set([
  "/",
  "/forms/20-18",
  "/forms/30-17",
  "/forms/24-19",
  "/forms/23-19",
  "/forms/25-15",
  "/forms/9-16",
  "/forms/op-h",
  "/forms/40-11",
]);

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  let path: string | undefined;
  try {
    const body = await req.json();
    path = typeof body?.path === "string" ? body.path : undefined;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!path || !ALLOWED_PATHS.has(path)) {
    return Response.json({ error: "Unknown path" }, { status: 400 });
  }

  try {
    await db.insert(landerViews).values({ path });
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/lander-view failed:", msg);
    // Beacon failures should be silent on the client side — tracking is
    // best-effort. Still return 500 so we can find issues in logs.
    return Response.json({ error: "Insert failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/lander-view",
};
