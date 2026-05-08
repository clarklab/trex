import { extractJson } from "./json-extract.js";
import type { Stage2Result } from "./report-pdf.js";

export const DEEP_PROMPT = `You are analyzing a Texas Real Estate Commission (TREC) contract in detail. Return ONLY valid JSON, no prose, no markdown fences.

Compare the contract against the corresponding standard TREC form. Identify EVERY clause that has been modified, added, or removed relative to the standard form.

For each modification, provide:
- "clause": short title for the clause (5-10 words)
- "standard_text": what the standard TREC form says (or "(clause not in standard form)" if added)
- "contract_text": what this contract says (or "(clause removed from standard)" if removed)
- "explanation": plain-English explanation of what changed and what it means for the parties (2-4 sentences)
- "risk": "low", "medium", or "high"
- "questions": array of 1-3 specific questions the user should ask the other party or their attorney

Also include "summary" (2-3 paragraph overall summary of the contract) and "full_terms" (key/value object of all material terms - price, dates, parties, financing, contingencies, etc).

Return this exact JSON structure:
{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "summary": "...",
  "modifications": [
    {
      "clause": "Inspection contingency",
      "standard_text": "...",
      "contract_text": "...",
      "explanation": "...",
      "risk": "high",
      "questions": ["...", "..."]
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
}`;

export function buildDeepPrompt(pdfText: string): string {
  return `${DEEP_PROMPT}\n\nContract text:\n---\n${pdfText}\n---`;
}

export function parseDeepResult(text: string): Stage2Result {
  return extractJson<Stage2Result>(text);
}
