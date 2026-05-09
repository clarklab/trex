// scripts/build-blank.mjs
//
// Usage:
//   node scripts/build-blank.mjs <input.pdf> <form_id>
//
// Produces:
//   assets/trec-blanks/<form_id>/page-N.png    (one per page, 1200px wide)
//   assets/trec-blanks/<form_id>/manifest.json
//
// Notes:
//   We render with a canvas allocated by pdfjs's internal NodeCanvasFactory
//   (which require()s @napi-rs/canvas from pdf.mjs's module scope). Using a
//   canvas/Path2D from our own ESM import of @napi-rs/canvas would be a
//   different module instance, and pdfjs's polyfilled globalThis.Path2D
//   would not be accepted by ctx.fill(path) — fails with "Value is none of
//   these types `String`, `Path`".

import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_WIDTH = 1200;

async function main() {
  const [, , inputPath, formId] = process.argv;
  if (!inputPath || !formId) {
    console.error("Usage: node scripts/build-blank.mjs <input.pdf> <form_id>");
    process.exit(2);
  }

  const buf = await fs.readFile(inputPath);
  const data = new Uint8Array(buf);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const canvasFactory = pdf._transport.canvasFactory;
  const outDir = resolve(__dirname, "..", "assets", "trec-blanks", formId);
  await fs.mkdir(outDir, { recursive: true });

  let pageHeight = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const { canvas } = canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvas, viewport }).promise;
    const png = await canvas.encode("png");
    await fs.writeFile(resolve(outDir, `page-${i}.png`), png);
    pageHeight = pageHeight ?? Math.round(viewport.height);
    console.log(`  page ${i}: ${viewport.width}×${Math.round(viewport.height)}`);
  }

  const manifest = {
    page_count: pdf.numPages,
    width: TARGET_WIDTH,
    height: pageHeight,
  };
  await fs.writeFile(
    resolve(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Wrote ${pdf.numPages} pages to ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
