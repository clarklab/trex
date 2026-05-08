import { getStore } from "@netlify/blobs";

export async function loadPdfBase64(blobKey: string): Promise<{
  base64: string;
  byteLength: number;
}> {
  const uploads = getStore("uploads");
  const buf = await uploads.get(blobKey, { type: "arrayBuffer" });
  if (!buf) {
    throw new Error(`PDF not found in blob store: ${blobKey}`);
  }
  const base64 = Buffer.from(buf).toString("base64");
  return { base64, byteLength: buf.byteLength };
}
