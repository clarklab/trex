import { getStore } from "@netlify/blobs";
import pdfParse from "pdf-parse";

const MAX_TOKENS_APPROX = 180_000;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_APPROX * CHARS_PER_TOKEN;

export async function extractPdfText(jobId: string, blobKey: string): Promise<string> {
  const uploads = getStore("uploads");
  const buf = await uploads.get(blobKey, { type: "arrayBuffer" });
  if (!buf) {
    throw new Error(`PDF not found for job ${jobId}`);
  }
  const parsed = await pdfParse(Buffer.from(buf));
  let text = parsed.text || "";
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[... truncated due to length ...]";
  }
  return text;
}
