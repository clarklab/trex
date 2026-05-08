import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { job_id?: string; total_chunks?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { job_id, total_chunks } = body;
  if (!job_id || typeof total_chunks !== "number" || total_chunks < 1) {
    return Response.json(
      { error: "Missing job_id or total_chunks" },
      { status: 400 },
    );
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, job_id));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "uploading") {
    return Response.json(
      { error: `Job not in uploading state (got: ${job.status})` },
      { status: 400 },
    );
  }

  const uploads = getStore("uploads");

  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  for (let i = 0; i < total_chunks; i++) {
    const chunk = await uploads.get(`${job_id}/chunk-${i}`, {
      type: "arrayBuffer",
    });
    if (!chunk) {
      return Response.json(
        { error: `Missing chunk ${i}` },
        { status: 400 },
      );
    }
    chunks.push(chunk);
    totalBytes += chunk.byteLength;
  }

  const assembled = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    assembled.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }

  const blobKey = `${job_id}/contract.pdf`;
  await uploads.set(blobKey, assembled.buffer as ArrayBuffer);

  for (let i = 0; i < total_chunks; i++) {
    try {
      await uploads.delete(`${job_id}/chunk-${i}`);
    } catch {
      // best-effort cleanup
    }
  }

  await db
    .update(jobs)
    .set({
      status: "processing",
      blobKey,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job_id));

  const siteUrl = Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || "";
  if (siteUrl) {
    fetch(`${siteUrl}/.netlify/functions/quick-scan-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id }),
    }).catch(() => {});

    fetch(`${siteUrl}/.netlify/functions/deep-scan-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id }),
    }).catch(() => {});
  }

  return Response.json({ job_id, status: "processing" });
};

export const config: Config = {
  path: "/api/upload-complete",
};
