export type Tier = "single" | "panel";

const SINGLE_FNS = ["deep-scan-background"];
const PANEL_FNS = [
  "panel-claude-background",
  "panel-gpt-background",
  "panel-gemini-background",
];

export function fanOutForTier(tier: Tier, jobId: string): void {
  const siteUrl =
    Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || "";
  if (!siteUrl) {
    console.warn("fanOut: SITE_URL/URL not set, skipping background fan-out");
    return;
  }

  const fns = tier === "panel" ? PANEL_FNS : SINGLE_FNS;
  for (const fn of fns) {
    fetch(`${siteUrl}/.netlify/functions/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    }).catch((err) => {
      console.warn(`fanOut: ${fn} failed:`, err);
    });
  }
}
