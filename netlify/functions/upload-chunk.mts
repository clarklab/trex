import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  const chunkIndex = url.searchParams.get("chunk_index");
  const totalChunks = url.searchParams.get("total_chunks");

  if (!jobId || chunkIndex === null || !totalChunks) {
    return Response.json(
      { error: "Missing job_id, chunk_index, or total_chunks" },
      { status: 400 },
    );
  }

  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);
  if (isNaN(idx) || isNaN(total) || idx < 0 || total < 1 || idx >= total) {
    return Response.json({ error: "Invalid chunk indices" }, { status: 400 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "uploading") {
    return Response.json(
      { error: `Job not in uploading state (got: ${job.status})` },
      { status: 400 },
    );
  }

  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) {
    return Response.json({ error: "Empty chunk" }, { status: 400 });
  }

  const uploads = getStore("uploads");
  await uploads.set(`${jobId}/chunk-${idx}`, buffer);

  return Response.json({ received: true, chunk_index: idx });
};

export const config: Config = {
  path: "/api/upload-chunk",
};
