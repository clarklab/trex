import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { contractStats } from "../../db/schema.js";
import { sql, isNotNull, gte } from "drizzle-orm";

// Public aggregate stats. By design returns nothing that could identify a
// specific contract: counts, medians, buckets only. Cached on the edge.

export default async (_req: Request, _context: Context) => {
  try {
    // Single round-trip with one big SELECT — keeps it cheap.
    const totalsQ = db
      .select({
        totalContracts: sql<number>`count(*)::int`,
        paidCount: sql<number>`sum(case when paid then 1 else 0 end)::int`,
        panelCount: sql<number>`sum(case when tier = 'panel' then 1 else 0 end)::int`,
        singleCount: sql<number>`sum(case when tier = 'single' then 1 else 0 end)::int`,
        last24hCount: sql<number>`sum(case when created_at > now() - interval '24 hours' then 1 else 0 end)::int`,
        last7dCount: sql<number>`sum(case when created_at > now() - interval '7 days' then 1 else 0 end)::int`,

        // Sales price stats (cents → dollars in the response)
        avgSalesPriceCents: sql<number>`coalesce(round(avg(sales_price_cents))::bigint, 0)`,
        medianSalesPriceCents: sql<number>`coalesce(percentile_cont(0.5) within group (order by sales_price_cents), 0)::bigint`,
        minSalesPriceCents: sql<number>`coalesce(min(sales_price_cents), 0)::bigint`,
        maxSalesPriceCents: sql<number>`coalesce(max(sales_price_cents), 0)::bigint`,
        totalSalesPriceCents: sql<number>`coalesce(sum(sales_price_cents), 0)::bigint`,

        // Down payment stats
        avgDownPaymentCents: sql<number>`coalesce(round(avg(down_payment_cents))::bigint, 0)`,
        medianDownPaymentCents: sql<number>`coalesce(percentile_cont(0.5) within group (order by down_payment_cents), 0)::bigint`,
        totalDownPaymentCents: sql<number>`coalesce(sum(down_payment_cents), 0)::bigint`,

        // Earnest + option fees
        avgEarnestMoneyCents: sql<number>`coalesce(round(avg(earnest_money_cents))::bigint, 0)`,
        avgOptionFeeCents: sql<number>`coalesce(round(avg(option_fee_cents))::bigint, 0)`,
        avgOptionPeriodDays: sql<number>`coalesce(round(avg(option_period_days)::numeric, 1)::float, 0)`,

        // Closing speed
        avgClosingDaysOut: sql<number>`coalesce(round(avg(closing_days_out)::numeric, 1)::float, 0)`,

        // Risk
        totalModifications: sql<number>`coalesce(sum(modification_count), 0)::int`,
        avgModifications: sql<number>`coalesce(round(avg(modification_count)::numeric, 2)::float, 0)`,
        totalSeverityHigh: sql<number>`coalesce(sum(severity_high), 0)::int`,
        totalSeverityMedium: sql<number>`coalesce(sum(severity_medium), 0)::int`,

        // Total bytes uploaded — fun system metric
        totalBytesUploaded: sql<number>`coalesce(sum(file_size_bytes), 0)::bigint`,
      })
      .from(contractStats);

    const formsQ = db
      .select({
        formId: contractStats.formId,
        formName: contractStats.formName,
        count: sql<number>`count(*)::int`,
      })
      .from(contractStats)
      .where(isNotNull(contractStats.formId))
      .groupBy(contractStats.formId, contractStats.formName)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const financingQ = db
      .select({
        financingType: contractStats.financingType,
        count: sql<number>`count(*)::int`,
      })
      .from(contractStats)
      .where(isNotNull(contractStats.financingType))
      .groupBy(contractStats.financingType)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const citiesQ = db
      .select({
        city: contractStats.propertyCity,
        state: contractStats.propertyState,
        count: sql<number>`count(*)::int`,
      })
      .from(contractStats)
      .where(isNotNull(contractStats.propertyCity))
      .groupBy(contractStats.propertyCity, contractStats.propertyState)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const dailyQ = db
      .select({
        day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(contractStats)
      .where(gte(contractStats.createdAt, sql`now() - interval '30 days'`))
      .groupBy(sql`date_trunc('day', created_at)`)
      .orderBy(sql`date_trunc('day', created_at) asc`);

    const [totals, forms, financing, cities, daily] = await Promise.all([
      totalsQ,
      formsQ,
      financingQ,
      citiesQ,
      dailyQ,
    ]);

    const t = totals[0];
    const dollars = (cents: number | null | undefined) =>
      cents == null ? 0 : Number(cents) / 100;

    return Response.json(
      {
        generated_at: new Date().toISOString(),
        totals: {
          contracts_scanned: t.totalContracts,
          contracts_paid: t.paidCount,
          panel_unlocks: t.panelCount,
          single_unlocks: t.singleCount,
          last_24h: t.last24hCount,
          last_7d: t.last7dCount,
          total_bytes_uploaded: Number(t.totalBytesUploaded),
        },
        sales_price: {
          mean_usd: dollars(t.avgSalesPriceCents),
          median_usd: dollars(t.medianSalesPriceCents),
          min_usd: dollars(t.minSalesPriceCents),
          max_usd: dollars(t.maxSalesPriceCents),
          total_usd: dollars(t.totalSalesPriceCents),
        },
        down_payment: {
          mean_usd: dollars(t.avgDownPaymentCents),
          median_usd: dollars(t.medianDownPaymentCents),
          total_usd: dollars(t.totalDownPaymentCents),
        },
        fees: {
          earnest_money_avg_usd: dollars(t.avgEarnestMoneyCents),
          option_fee_avg_usd: dollars(t.avgOptionFeeCents),
          option_period_avg_days: t.avgOptionPeriodDays,
        },
        closing: {
          avg_days_out: t.avgClosingDaysOut,
        },
        risk: {
          total_modifications_flagged: t.totalModifications,
          modifications_per_contract_avg: t.avgModifications,
          high_severity_total: t.totalSeverityHigh,
          medium_severity_total: t.totalSeverityMedium,
        },
        forms: forms.map((f) => ({
          form_id: f.formId,
          name: f.formName,
          count: f.count,
        })),
        financing_mix: financing.map((f) => ({
          type: f.financingType,
          count: f.count,
        })),
        top_cities: cities.map((c) => ({
          city: c.city,
          state: c.state,
          count: c.count,
        })),
        daily_30d: daily.map((d) => ({ day: d.day, count: d.count })),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/stats failed:", msg);
    return Response.json(
      { error: "Failed to compute stats", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/stats",
};
