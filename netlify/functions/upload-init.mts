import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";

const MAX_SIZE = 10 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { filename?: string; size?: number; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { filename, size, mime_type } = body;

  if (!filename || typeof filename !== "string") {
    return Response.json({ error: "Missing filename" }, { status: 400 });
  }
  if (typeof size !== "number" || size <= 0) {
    return Response.json({ error: "Invalid size" }, { status: 400 });
  }
  if (size > MAX_SIZE) {
    return Response.json(
      { error: `File too large. Max ${MAX_SIZE} bytes.` },
      { status: 400 },
    );
  }
  if (mime_type !== "application/pdf") {
    return Response.json(
      { error: "Only PDF files are accepted" },
      { status: 400 },
    );
  }

  const [job] = await db
    .insert(jobs)
    .values({
      filename,
      fileSize: size,
      status: "uploading",
    })
    .returning();

  return Response.json({
    job_id: job.id,
    chunk_size: CHUNK_SIZE,
  });
};

export const config: Config = {
  path: "/api/upload-init",
};
