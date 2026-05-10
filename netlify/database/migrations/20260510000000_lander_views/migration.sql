CREATE TABLE "lander_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "path" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Index on (path, created_at) for the GROUP BY path WHERE created_at > X
-- query the /landers page issues. Most queries filter on a recent window
-- and aggregate by path, so this composite covers them.
CREATE INDEX "lander_views_path_created_idx"
  ON "lander_views" ("path", "created_at" DESC);
