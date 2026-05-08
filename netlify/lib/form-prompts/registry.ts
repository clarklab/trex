import { TREC_20_18_PROMPT } from "./trec-20-18.js";
import { TREC_20_18_REF_TEXT } from "./trec-20-18-ref.js";

export interface FormPromptEntry {
  formId: string;
  name: string;
  prompt: string | null;
  referenceText: string | null;
  supported: boolean;
}

const FORMS: FormPromptEntry[] = [
  {
    formId: "20-18",
    name: "One to Four Family Residential Contract (Resale)",
    prompt: TREC_20_18_PROMPT,
    referenceText: TREC_20_18_REF_TEXT,
    supported: true,
  },
  {
    formId: "30-17",
    name: "Residential Condominium Contract (Resale)",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "24-19",
    name: "New Home Contract (Completed Construction)",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "23-19",
    name: "New Home Contract (Incomplete Construction)",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "25-15",
    name: "Farm and Ranch Contract",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "9-16",
    name: "Unimproved Property Contract",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "OP-H",
    name: "Seller's Disclosure Notice",
    prompt: null,
    referenceText: null,
    supported: false,
  },
  {
    formId: "40-11",
    name: "Third Party Financing Addendum",
    prompt: null,
    referenceText: null,
    supported: false,
  },
];

const BY_ID = new Map(FORMS.map((f) => [f.formId, f]));

export function getFormEntry(formId: string | null | undefined): FormPromptEntry | null {
  if (!formId) return null;
  return BY_ID.get(formId) || null;
}

export function isFormSupported(formId: string | null | undefined): boolean {
  return !!getFormEntry(formId)?.supported;
}
