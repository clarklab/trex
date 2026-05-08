import { extractJson } from "./json-extract.js";
import type { Stage2Result } from "./report-pdf.js";
import { getFormEntry } from "./form-prompts/registry.js";

const JSON_OUTPUT_INSTRUCTION = `
---

## OUTPUT FORMAT — REQUIRED

Ignore any prior output-format instructions in this prompt. Return **ONLY valid JSON**, no prose, no markdown fences. The JSON must match this exact shape:

\`\`\`json
{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "summary": "2-3 paragraph plain-English summary of the contract, the parties, and the most important issues.",
  "modifications": [
    {
      "clause": "Short title (5-10 words)",
      "standard_text": "What the standard TREC form says (or '(clause not in standard form)' if added).",
      "contract_text": "What this contract says (or '(clause removed from standard)' if removed).",
      "explanation": "Plain-English explanation of what changed and what it means for the parties (2-4 sentences).",
      "risk": "low | medium | high",
      "questions": ["Question 1 to ask the other party", "Question 2", "..."]
    }
  ],
  "full_terms": {
    "price": "$350,000",
    "earnest_money": "$5,000",
    "option_period_days": "10",
    "closing_date": "2025-03-15",
    "buyer": "Jane Doe",
    "seller": "John Smith",
    "financing_type": "Conventional"
  }
}
\`\`\`

Rules for the JSON:
- Every modification you flag (under your Step 5 form-integrity check, Step 6 addenda check, and Step 7 internal-consistency check) goes into "modifications".
- Use "high" for critical / unenforceable / UPL exposure / missing required addendum issues. Use "medium" for inconsistencies, missing initials, ambiguous deadlines. Use "low" for minor notes.
- "summary" is plain English for a non-lawyer.
- "full_terms" is a flat key/value object of every material business term you extracted in Step 2.
- If the contract appears clean (no modifications), return an empty modifications array.
`;

const FALLBACK_PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract in detail. The form-specific reference is not available, so use your general knowledge of TREC promulgated forms.

Compare the contract against your understanding of the corresponding standard TREC form. Identify EVERY clause that has been modified, added, or removed.

For each modification, classify the risk and explain in plain English. Identify the form, summarize the contract, and extract every material term.`;

/**
 * Builds the instruction text for a deep scan when the executed
 * contract is being attached to the request as a PDF document
 * (Anthropic content type "document"). The reference form is still
 * embedded as text since it's static per form.
 */
export function buildDeepPromptForAttachment(formId?: string | null): string {
  const entry = getFormEntry(formId);
  const reviewPrompt = entry?.prompt || FALLBACK_PROMPT;
  const referenceBlock = entry?.referenceText
    ? `## REFERENCE FORM (blank ${entry.formId})\n\n${entry.referenceText}\n\n---\n\n`
    : "";

  return `${reviewPrompt}\n\n${referenceBlock}## EXECUTED CONTRACT\n\nThe executed contract is attached as a PDF document above. Read it directly — including any handwritten or typed entries, signatures, and stamps. Compare its printed-form paragraphs to the REFERENCE FORM text shown above.\n\n---\n${JSON_OUTPUT_INSTRUCTION}`;
}

/**
 * Legacy text-based prompt builder kept for backwards-compatibility.
 * Prefer buildDeepPromptForAttachment + a PDF document content block —
 * pdf-parse strips out scanned pages and produces empty input.
 */
export function buildDeepPrompt(pdfText: string, formId?: string | null): string {
  const entry = getFormEntry(formId);
  const reviewPrompt = entry?.prompt || FALLBACK_PROMPT;
  const referenceBlock = entry?.referenceText
    ? `## REFERENCE FORM (blank ${entry.formId})\n\n${entry.referenceText}\n\n---\n\n`
    : "";

  return `${reviewPrompt}\n\n${referenceBlock}## EXECUTED CONTRACT (under review)\n\n${pdfText}\n\n---\n${JSON_OUTPUT_INSTRUCTION}`;
}

export function parseDeepResult(text: string): Stage2Result {
  return extractJson<Stage2Result>(text);
}
