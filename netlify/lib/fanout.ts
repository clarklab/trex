import type { Context } from "@netlify/functions";

export type Tier = "single" | "panel";

const SINGLE_FNS = ["deep-scan-background"];
const PANEL_FNS = [
  "panel-claude-background",
  "panel-gpt-background",
  "panel-gemini-background",
];

export function fanOutForTier(
  tier: Tier,
  jobId: string,
  context: Context,
  reqOrigin?: string,
): void {
  const siteUrl =
    Netlify.env.get("SITE_URL") ||
    Netlify.env.get("URL") ||
    reqOrigin ||
    "";
  if (!siteUrl) {
    console.error(
      "fanOut: no SITE_URL/URL/req.origin available — background scan won't trigger",
    );
    return;
  }

  const fns = tier === "panel" ? PANEL_FNS : SINGLE_FNS;
  for (const fn of fns) {
    const target = `${siteUrl}/.netlify/functions/${fn}`;
    console.log(`fanOut[${tier}]: triggering ${fn} at ${target}`);
    context.waitUntil(
      fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      })
        .then((res) => {
          console.log(`fanOut[${tier}]: ${fn} returned ${res.status}`);
        })
        .catch((err) => {
          console.error(
            `fanOut[${tier}]: failed to trigger ${fn}:`,
            err instanceof Error ? err.message : err,
          );
        }),
    );
  }
}
