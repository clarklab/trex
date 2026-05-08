import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { loadPdfBase64 } from "../lib/pdf-blob.js";
import { extractJson } from "../lib/json-extract.js";

const PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract PDF that is attached above. Read the PDF directly — including any handwritten or typed entries, signatures, stamps, and scanned pages. Return ONLY valid JSON, no prose, no markdown fences.

Identify the form. Supported standard TREC forms:
- 20-18: One to Four Family Residential Contract (Resale)
- 30-17: Residential Condominium Contract (Resale)
- 24-19: New Home Contract (Completed Construction)
- 23-19: New Home Contract (Incomplete Construction)
- 25-15: Farm and Ranch Contract
- 9-16: Unimproved Property Contract
- OP-H: Seller's Disclosure Notice
- 40-11: Third Party Financing Addendum

Return this exact JSON structure:

{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "confidence": 92,
  "page_count": 11,
  "property_address": "1428 Magnolia Ave, Austin TX 78704",
  "modification_count": 0,
  "status": "reviewable",
  "severity_high": 1,
  "severity_medium": 2,
  "red_flags": [
    {"title": "Option period is below market", "severity": "high"},
    {"title": "Special provisions include non-standard language", "severity": "medium"},
    {"title": "Earnest money below typical", "severity": "low"}
  ],
  "terms": {
    "sales_price":         {"value": "$485,000",          "note": "Paragraph 3 · §3",        "warning": null},
    "earnest_money":       {"value": "$5,000",            "note": "1.0% of price · §5A",     "warning": null},
    "option_fee_period":   {"value": "$250 · 7 days",     "note": "Expires May 15 · §23",    "warning": "Below market: median is $500 / 10 days"},
    "title_notice_period": {"value": "5 days",            "note": "Standard · §6D",          "warning": null},
    "closing_date":        {"value": "Jun 28, 2026",      "note": "52 days from effective · §9", "warning": null},
    "financing":           {"value": "Conventional · $388K", "note": "80% LTV · TREC 40-11", "warning": null},
    "survey":              {"value": "Buyer pays",        "note": "§6C(2) · existing survey", "warning": null},
    "special_provisions":  {"value": "2 lines",           "note": "§11 · review recommended","warning": "Includes non-standard language"}
  }
}

Field rules:

- **form_id**: one of the 8 form IDs above, or "unknown" if you genuinely cannot identify the form. Do not return "unknown" if you have ANY confidence — pick the closest match and lower the confidence number instead.
- **confidence**: integer 0-100. 80+ = certain. 50-79 = likely. <50 = guessing.
- **page_count**: integer count of pages in the PDF.
- **property_address**: full street address (street, city, state, zip) of the subject property if filled in. Null if blank.
- **modification_count**: integer count of clauses where the printed form text appears modified, struck through, or added to (NOT including blanks being filled in). 0 if it's a clean form. This is your best estimate from a quick scan — the deep review will be more thorough.
- **status**: "reviewable" if the contract is clean enough to move forward with normal review. "needs_attention" if you found issues that warrant closer look before proceeding. "unparseable" only if the document is truly illegible (badly scanned, wrong language, not a TREC form at all).
- **severity_high / severity_medium**: integer counts of issues at each severity level. Used to render badges like "1 high · 2 medium".
- **red_flags**: array of 1-5 objects, each {title, severity}. Severity is "high", "medium", or "low". Titles are 5-10 words.
- **terms**: each entry is {value, note, warning}.
  - "value": the headline number/string for that field (e.g. "$485,000", "Buyer pays", "5 days"). Null if the field is genuinely blank.
  - "note": a short caption shown smaller below the value. Should reference the paragraph or section number where you found it (e.g. "Paragraph 3 · §3", "1.0% of price · §5A"). For derived metrics like "52 days from effective" or "80% LTV", include those. Null if no useful caption.
  - "warning": short orange-pill text if something looks off about that field (e.g. "Below market: median is $500 / 10 days", "Includes non-standard language", "Blank — should be filled"). Null if nothing to flag.
- For TREC 20-18, common paragraph references: §3 sales price, §5 earnest money/option fee, §6 title/survey, §9 closing, §11 special provisions, §22 addenda. Reference the actual paragraph the value comes from.

Calibration for warnings:
- Option period under 5 days: warn "Unusually short option period"
- Option fee under $200: warn "Below market: typical is $300-500"
- Earnest money under 0.5% of price: warn "Earnest money low for this price"
- Special provisions with anything beyond facts (any contractual-sounding language): warn "Includes non-standard language"
- Buyer/seller name or address blank: warn "Blank — should be filled"
- Closing date before effective date or before option period ends: warn "Date conflict"

**Sales Price (§3) — read carefully:**
On the first page, TREC §3 has THREE related dollar amounts that you MUST find:
- §3A: Cash portion of Sales Price (the down-payment amount Buyer pays at closing)
- §3B: Sum of all financing described in the addenda (loan amount)
- §3C: Sales Price = 3A + 3B (the total)

Do NOT report just one of these as the sales price. Always report 3C as the headline value, and include the 3A/3B breakdown in the note.

For sales_price specifically:
- "value": the §3C total, formatted as currency (e.g. "$355,000").
- "note": the breakdown including the paragraph reference, e.g.
  "$70,000 cash + $285,000 financed · §3"
  (write the numbers verbatim, do not abbreviate to "K" — this is a financial figure).
- "warning": if 3A + 3B does not equal 3C, set a warning like
  "Math error: $70,000 + $285,000 = $355,000, but §3C reads $375,000."
  Also warn if 3C is blank but 3A/3B are filled (or vice versa).
  Otherwise null.

Do NOT report "no contract text provided" or similar — you have the PDF document attached above. Read it.`;

export interface TermField {
  value: string | null;
  note: string | null;
  warning: string | null;
}

export interface Stage1Result {
  form_id: string;
  form_name: string;
  confidence: number;
  page_count: number;
  property_address: string | null;
  modification_count: number;
  status: "reviewable" | "needs_attention" | "unparseable";
  severity_high: number;
  severity_medium: number;
  red_flags: { title: string; severity: "high" | "medium" | "low" }[];
  terms: {
    sales_price?: TermField | null;
    earnest_money?: TermField | null;
    option_fee_period?: TermField | null;
    title_notice_period?: TermField | null;
    closing_date?: TermField | null;
    financing?: TermField | null;
    survey?: TermField | null;
    special_provisions?: TermField | null;
  };
}

export default async (req: Request, _context: Context) => {
  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const jobId = body.job_id;
  if (!jobId) {
    return new Response("Missing job_id", { status: 400 });
  }

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job || !job.blobKey) {
      console.error(`quick-scan: job ${jobId} not found or no blob key`);
      return new Response("Job not found", { status: 404 });
    }
    if (job.status !== "processing") {
      console.log(`quick-scan: job ${jobId} not processing (${job.status}), exiting`);
      return new Response("ok", { status: 200 });
    }

    await db
      .update(jobs)
      .set({ stage1Status: "running", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const { base64, byteLength } = await loadPdfBase64(job.blobKey);
    console.log(
      `quick-scan ${jobId}: loaded PDF (${byteLength} bytes), calling Haiku with document attachment`,
    );

    const anthropic = new Anthropic({ timeout: 120_000 });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3072,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("AI response had no text content");
    }
    const result = extractJson<Stage1Result>(firstBlock.text);
    console.log(
      `quick-scan ${jobId}: ${result.form_id} @ ${result.confidence}%, ${result.page_count}pp, ${result.severity_high ?? 0}h ${result.severity_medium ?? 0}m`,
    );

    await db
      .update(jobs)
      .set({
        stage1Status: "complete",
        stage1Result: result,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`quick-scan ${jobId} failed:`, msg);
    await db
      .update(jobs)
      .set({
        stage1Status: "error",
        stage1Error: msg,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {};
