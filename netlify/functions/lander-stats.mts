import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { landerViews, contractStats } from "../../db/schema.js";
import { sql, isNotNull } from "drizzle-orm";

// Aggregates per-lander metrics for the /landers overview dashboard.
//
// Returns:
//   landers: [{ path, views_total, views_30d, views_24h }]
//   forms:   [{ form_id, scans_total, scans_30d, scans_24h, paid }]
//
// The /landers page joins these client-side by mapping a lander path
// (e.g. "/forms/20-18") to a form id (e.g. "20-18"). Homepage path "/"
// has no associated form id, so it just shows view stats.
//
// Cached at the edge for 60 seconds — the dashboard is a low-traffic
// internal-ish page, no need to hit the DB on every refresh.

export default async (_req: Request, _context: Context) => {
  try {
    const viewsQ = db
      .select({
        path: landerViews.path,
        viewsTotal: sql<number>`count(*)::int`,
        views30d: sql<number>`sum(case when created_at > now() - interval '30 days' then 1 else 0 end)::int`,
        views24h: sql<number>`sum(case when created_at > now() - interval '24 hours' then 1 else 0 end)::int`,
      })
      .from(landerViews)
      .groupBy(landerViews.path);

    const formsQ = db
      .select({
        formId: contractStats.formId,
        scansTotal: sql<number>`count(*)::int`,
        scans30d: sql<number>`sum(case when created_at > now() - interval '30 days' then 1 else 0 end)::int`,
        scans24h: sql<number>`sum(case when created_at > now() - interval '24 hours' then 1 else 0 end)::int`,
        paid: sql<number>`sum(case when paid then 1 else 0 end)::int`,
      })
      .from(contractStats)
      .where(isNotNull(contractStats.formId))
      .groupBy(contractStats.formId);

    const [views, forms] = await Promise.all([viewsQ, formsQ]);

    return Response.json(
      {
        generated_at: new Date().toISOString(),
        landers: views.map((v) => ({
          path: v.path,
          views_total: v.viewsTotal,
          views_30d: v.views30d,
          views_24h: v.views24h,
        })),
        forms: forms.map((f) => ({
          form_id: f.formId,
          scans_total: f.scansTotal,
          scans_30d: f.scans30d,
          scans_24h: f.scans24h,
          paid: f.paid,
        })),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/lander-stats failed:", msg);
    return Response.json(
      { error: "Failed to compute lander stats", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/lander-stats",
};
