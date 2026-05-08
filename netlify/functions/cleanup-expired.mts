import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { lt, eq } from "drizzle-orm";
import { getStore } from "@netlify/blobs";

export default async (_req: Request, _context: Context) => {
  const cutoff = new Date(Date.now() - 86_400_000);
  const expired = await db.select().from(jobs).where(lt(jobs.createdAt, cutoff));

  const uploads = getStore("uploads");
  const reports = getStore("reports");

  let deleted = 0;
  for (const job of expired) {
    if (job.blobKey) {
      try {
        await uploads.delete(job.blobKey);
      } catch {
        // ignore
      }
    }
    if (job.reportBlobKey) {
      try {
        await reports.delete(job.reportBlobKey);
      } catch {
        // ignore
      }
    }
    await db.delete(checkoutSessions).where(eq(checkoutSessions.jobId, job.id));
    await db.delete(jobs).where(eq(jobs.id, job.id));
    deleted++;
  }

  return Response.json({ deleted });
};

export const config: Config = {
  schedule: "@daily",
};
