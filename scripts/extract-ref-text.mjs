// Regenerates netlify/lib/form-prompts/*-ref.ts from the source PDFs in form-prompts/.
// Run after updating any form-prompts/*_ref.pdf:  node scripts/extract-ref-text.mjs

import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";

const PROMPTS_DIR = path.resolve(process.cwd(), "form-prompts");
const OUT_DIR = path.resolve(process.cwd(), "netlify/lib/form-prompts");

const PDFS = [
  { source: "trec_20-18_ref.pdf", out: "trec-20-18-ref.ts", export: "TREC_20_18_REF_TEXT" },
];

for (const item of PDFS) {
  const pdfPath = path.join(PROMPTS_DIR, item.source);
  if (!fs.existsSync(pdfPath)) {
    console.warn(`skip ${item.source} (not found)`);
    continue;
  }
  const buf = fs.readFileSync(pdfPath);
  const parsed = await pdfParse(buf);
  const text = parsed.text;
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  const ts =
    `// Extracted from form-prompts/${item.source} via pdf-parse.\n` +
    `// Regenerate with: node scripts/extract-ref-text.mjs\n\n` +
    `export const ${item.export} = \`${escaped}\`;\n`;
  fs.writeFileSync(path.join(OUT_DIR, item.out), ts);
  console.log(
    `wrote ${item.out} (${parsed.numpages} pages, ${text.length} chars)`,
  );
}
