// Pull anonymized aggregate stats out of a Stage1Result.
//
// Stage1 returns a structured shape but the term VALUES are still loose
// strings (e.g. "$485,000", "$250 · 7 days", "Conventional · $388K"). This
// module turns them into clean numbers / dates / enums so we can run real
// aggregations. Only safe-to-expose data is returned: no street address,
// no party names, no clause text.

import type { NewContractStats } from "../../db/schema.js";

interface TermField {
  value: string | null;
  note: string | null;
  warning: string | null;
}

interface Stage1Like {
  form_id?: string | null;
  form_name?: string | null;
  confidence?: number | null;
  page_count?: number | null;
  property_address?: string | null;
  modification_count?: number | null;
  status?: string | null;
  severity_high?: number | null;
  severity_medium?: number | null;
  red_flags?: { severity?: string }[];
  terms?: {
    sales_price?: TermField | null;
    earnest_money?: TermField | null;
    option_fee_period?: TermField | null;
    closing_date?: TermField | null;
    financing?: TermField | null;
    [k: string]: TermField | null | undefined;
  };
}

export function extractStats(
  jobId: string,
  stage1: unknown,
  fileSizeBytes: number | null,
): Omit<NewContractStats, "id" | "createdAt" | "updatedAt"> | null {
  if (!stage1 || typeof stage1 !== "object") return null;
  const s = stage1 as Stage1Like;

  const terms = s.terms || {};
  const salesPriceCents = parseDollars(terms.sales_price?.value);
  const earnestMoneyCents = parseDollars(terms.earnest_money?.value);
  const { optionFeeCents, optionPeriodDays } = parseOptionFeePeriod(
    terms.option_fee_period?.value,
  );
  const closing = parseClosing(terms.closing_date?.value);
  const { financingType, financingAmountCents } = parseFinancing(
    terms.financing?.value,
  );

  // down_payment ≈ sales_price − financing_amount, when both known.
  // (TREC contracts split price into 3A cash + 3B financing; financing pane
  //  shows 3B, so 3A = sales − financing = down payment.)
  const downPaymentCents =
    salesPriceCents !== null && financingAmountCents !== null
      ? Math.max(0, salesPriceCents - financingAmountCents)
      : null;

  const { city, state, zip } = parseCityStateZip(s.property_address);

  // severity_low isn't returned directly by stage1 — derive from red_flags.
  const sevLowFromFlags = Array.isArray(s.red_flags)
    ? s.red_flags.filter((f) => f.severity === "low").length
    : 0;

  return {
    jobId,
    formId: s.form_id ?? null,
    formName: s.form_name ?? null,
    pageCount: s.page_count ?? null,
    confidence: s.confidence ?? null,
    formStatus: s.status ?? null,

    salesPriceCents,
    earnestMoneyCents,
    optionFeeCents,
    optionPeriodDays,
    downPaymentCents,
    financingAmountCents,
    financingType,

    propertyCity: city,
    propertyState: state,
    propertyZip: zip,

    effectiveDate: null,
    closingDate: closing,
    closingDaysOut: closing ? daysFromTodayTo(closing) : null,

    modificationCount: s.modification_count ?? null,
    severityHigh: s.severity_high ?? null,
    severityMedium: s.severity_medium ?? null,
    severityLow: sevLowFromFlags,

    tier: null,
    paid: false,

    fileSizeBytes: fileSizeBytes ?? null,
  };
}

// "$485,000" -> 48500000  (cents)
// "$1.2M"    -> 120000000
// "$388K"    -> 38800000
// "—" / null -> null
export function parseDollars(input: unknown): number | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw || raw === "—" || raw === "-") return null;

  // Find the first $-prefixed number token.
  const m = raw.match(
    /\$\s*([\d.,]+)\s*([kKmMbB])?/,
  );
  if (!m) {
    // Try a bare number at start.
    const m2 = raw.match(/^([\d.,]+)\s*([kKmMbB])?/);
    if (!m2) return null;
    return numberWithSuffixToCents(m2[1], m2[2]);
  }
  return numberWithSuffixToCents(m[1], m[2]);
}

function numberWithSuffixToCents(numStr: string, suffix?: string): number | null {
  const cleaned = numStr.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  const mult =
    suffix && /[kK]/.test(suffix) ? 1_000
      : suffix && /[mM]/.test(suffix) ? 1_000_000
        : suffix && /[bB]/.test(suffix) ? 1_000_000_000
          : 1;
  return Math.round(n * mult * 100);
}

// "$250 · 7 days" -> { optionFeeCents: 25000, optionPeriodDays: 7 }
// "$500 / 10 days" -> { ..., 10 }
export function parseOptionFeePeriod(
  input: unknown,
): { optionFeeCents: number | null; optionPeriodDays: number | null } {
  if (input == null) return { optionFeeCents: null, optionPeriodDays: null };
  const raw = String(input);
  const fee = parseDollars(raw);
  const daysMatch = raw.match(/(\d+)\s*day/i);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : null;
  return { optionFeeCents: fee, optionPeriodDays: days };
}

// "Conventional · $388K" -> { financingType: "Conventional", financingAmountCents: 38800000 }
// "FHA $375,000" -> { financingType: "FHA", financingAmountCents: 37500000 }
// "Cash" -> { financingType: "Cash", financingAmountCents: 0 }
export function parseFinancing(
  input: unknown,
): { financingType: string | null; financingAmountCents: number | null } {
  if (input == null) return { financingType: null, financingAmountCents: null };
  const raw = String(input).trim();
  if (!raw || raw === "—") return { financingType: null, financingAmountCents: null };

  if (/^cash\b/i.test(raw)) {
    return { financingType: "Cash", financingAmountCents: 0 };
  }

  const typeMatch = raw.match(
    /(conventional|fha|va|usda|seller\s*financing|owner\s*financing|other)/i,
  );
  const financingType = typeMatch
    ? typeMatch[1].replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  const financingAmountCents = parseDollars(raw);
  return { financingType, financingAmountCents };
}

// "Jun 28, 2026" -> "2026-06-28"
// "2026-06-28"   -> "2026-06-28"
// "—" / garbage -> null
export function parseClosing(input: unknown): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw || raw === "—") return null;

  // Try ISO first.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Try "Mon DD, YYYY" / "Month DD, YYYY".
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    if (d.getFullYear() < 2000 || d.getFullYear() > 2100) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// "1428 Magnolia Ave, Austin TX 78704" -> { city: "Austin", state: "TX", zip: "78704" }
// "Austin, TX 78704" -> same
// Strict policy: never return the street part.
export function parseCityStateZip(
  input: unknown,
): { city: string | null; state: string | null; zip: string | null } {
  if (input == null) return { city: null, state: null, zip: null };
  const raw = String(input).trim();
  if (!raw) return { city: null, state: null, zip: null };

  // "[city] [STATE] [zip]" - the trailing 5-digit zip is what we care about.
  const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;

  // State is two consecutive uppercase letters near the end (or "Texas").
  const stateMatch = raw.match(/\b([A-Z]{2})\b\s*\d{5}\b/) ||
    raw.match(/,\s*([A-Z]{2})\b/);
  let state: string | null = stateMatch ? stateMatch[1] : null;
  if (!state && /\btexas\b/i.test(raw)) state = "TX";

  // City: text immediately before state/zip.
  let city: string | null = null;
  if (state) {
    // Pattern A: "..., City, ST 78704"
    const a = raw.match(/,\s*([A-Za-z][A-Za-z\s.'-]+?)\s*,?\s*[A-Z]{2}\b\s*\d{5}/);
    if (a) {
      city = a[1].trim();
    } else {
      // Pattern B: "City, ST 78704" with no leading street.
      const b = raw.match(/^([A-Za-z][A-Za-z\s.'-]+?)\s*,?\s*[A-Z]{2}\b\s*\d{5}/);
      if (b) city = b[1].trim();
    }
  }

  return { city, state, zip };
}

function daysFromTodayTo(isoDate: string): number | null {
  const d = Date.parse(isoDate);
  if (Number.isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / (1000 * 60 * 60 * 24));
}
