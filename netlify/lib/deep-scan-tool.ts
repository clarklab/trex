// Anthropic tool definition for the deep-scan output schema. Using tool
// use means the Anthropic API parses the structured output itself —
// the model can't return malformed JSON because the API enforces the
// schema. Replaces the previous "ask for JSON in text, parse with
// salvage" approach which was fragile on large or complex contracts.

export const SUBMIT_REVIEW_TOOL = {
  name: "submit_review",
  description:
    "Submit your TREC contract review. You MUST call this tool with the structured review — do not output prose or text outside the tool call.",
  input_schema: {
    type: "object" as const,
    required: ["form_id", "form_name", "summary", "modifications", "full_terms"],
    properties: {
      form_id: {
        type: "string",
        description: "TREC form ID, e.g. '20-18'.",
      },
      form_name: {
        type: "string",
        description: "Full form name, e.g. 'One to Four Family Residential Contract (Resale)'.",
      },
      summary: {
        type: "string",
        description: "2-3 paragraph plain-English summary of the contract, parties, and key issues.",
      },
      modifications: {
        type: "array",
        description:
          "Every clause that has been modified, added, or removed compared to the standard form. Empty array if none.",
        items: {
          type: "object",
          required: [
            "clause",
            "standard_text",
            "contract_text",
            "explanation",
            "risk",
            "questions",
          ],
          properties: {
            clause: {
              type: "string",
              description: "Short title of the clause (5-10 words).",
            },
            standard_text: {
              type: "string",
              description:
                "What the standard TREC form says, or '(clause not in standard form)' if added.",
            },
            contract_text: {
              type: "string",
              description:
                "What this contract says, or '(clause removed from standard)' if removed.",
            },
            explanation: {
              type: "string",
              description:
                "Plain-English explanation of what changed and what it means for the parties (2-4 sentences).",
            },
            risk: {
              type: "string",
              enum: ["low", "medium", "high"],
              description:
                "Risk level: 'high' for critical/unenforceable/UPL exposure/missing required addendum issues; 'medium' for inconsistencies, missing initials, ambiguous deadlines; 'low' for minor notes.",
            },
            questions: {
              type: "array",
              items: { type: "string" },
              description:
                "Questions to ask the other party about this modification.",
            },
          },
        },
      },
      full_terms: {
        type: "object",
        description:
          "Flat key/value object of every material business term you extracted. Keys like 'price', 'earnest_money', 'option_period_days', 'closing_date', 'buyer', 'seller', 'financing_type'.",
        additionalProperties: { type: ["string", "number", "null"] },
      },
    },
  },
};
