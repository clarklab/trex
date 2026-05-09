# Standalone Report Page with Visual Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shareable `/r/<code>` dashboard that becomes the buyer's persistent login, plus a pixel-overlay viewer that compares their contract to the blank TREC 20-18 form, plus pre-warmed Polar checkouts so Pay feels instant.

**Architecture:** New `recovery_code` column on `checkout_sessions`, new `/api/r/:code` resolver, new static `r.html` + `js/r.js` dashboard. Overlay uses lazy-loaded `pdfjs-dist` to rasterize the user PDF in-browser; reference is pre-baked PNGs committed to the repo. Polar pre-warming is purely a frontend optimization (two parallel `/api/checkout-init` calls cached on the upload page).

**Tech Stack:** Netlify Functions v2 (TypeScript `.mts`), drizzle-orm + Netlify Postgres, Netlify Blobs, vanilla JS modules with dynamic `import()`, pdfjs-dist v4 from jsDelivr CDN.

**Codebase notes:**
- No test runner is configured. For unit-testable pure functions, use `npx tsx <file>` ad-hoc (the same pattern used for `stats-extract.ts` parsers — see commit `e094e44` for an example test sweep).
- `npm run build` runs `tsc --noEmit`. Run after every code-touching task.
- Push directly to `main` (per project memory `feedback_push_to_main.md`). Don't open PRs.

---

## Phase 1 — Foundation (silent infrastructure, no UX change)

Phase 1 is shippable on its own: it adds the column, the resolver, and refactors render helpers. Nothing the user sees changes.

### Task 1.1: Extract render helpers from `app.js` into `js/render.js`

**Files:**
- Create: `js/render.js`
- Modify: `js/app.js`

**Goal:** move the report-rendering and loader-controller code that the dashboard will need into a shared module, with no behavior change on the upload page.

- [ ] **Step 1: Create `js/render.js` with the helpers**

```js
// js/render.js — shared rendering helpers used by the upload page (app.js)
// and the standalone dashboard (r.js).

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/\s+/g, "-");
}

export function friendlyDeepError(rawError) {
  const e = String(rawError || "").toLowerCase();
  if (e.includes("expected") && e.includes("json")) {
    return "The model returned an unparseable response. This usually means it ran long and got cut off — refreshing usually fixes it.";
  }
  if (e.includes("timeout") || e.includes("timed out")) {
    return "The analysis took too long and timed out. Refresh to retry — large contracts sometimes need a second pass.";
  }
  if (e.includes("rate") && e.includes("limit")) {
    return "The AI provider is rate-limiting us right now. Wait a minute and refresh.";
  }
  if (e.includes("api key") || e.includes("authentication")) {
    return "We had a credentials problem on our end. Contact support and include the job ID from the URL.";
  }
  return "Something went wrong while generating your report. Refreshing usually fixes it.";
}

// generating-loader controller — module-private state.
const REX_POSES = [
  "/assets/rex.png",
  "/assets/rex-concern.png",
  "/assets/rex-cheer.png",
];
const SINGLE_LOADER_MESSAGES = [
  "Reading every paragraph carefully…",
  "Cross-checking against the standard form…",
  "Looking for red flags…",
  "Doing the sales-price math…",
  "Decoding any legal jargon…",
  "Drafting your summary…",
  "Polishing the report…",
  "Almost there…",
];
const PANEL_LOADER_MESSAGES = [
  "Three frontier AIs are reading your contract…",
  "Each model is drafting its review independently…",
  "Watching where they agree and disagree…",
  "Nothing makes a contract clearer than three opinions on it.",
  "Polishing the panel report…",
  "Almost there…",
];
const loaderTimers = { msg: null, hero: null, trio: null };

export function showGeneratingLoader(tier) {
  const loader = document.getElementById("generating-loader");
  if (!loader) return;
  const card = loader.querySelector(".generating-card");
  const single = loader.querySelector('.rex-stage[data-mode="single"]');
  const panel = loader.querySelector('.rex-stage[data-mode="panel"]');
  const headline = document.getElementById("generating-headline");
  const meta = document.getElementById("generating-meta");
  const actions = document.getElementById("generating-actions");

  if (card) card.classList.remove("is-error");
  if (actions) actions.hidden = true;
  if (meta) {
    meta.textContent = "This usually takes 20–60 seconds. Don't close this tab.";
    meta.hidden = false;
  }

  if (tier === "panel") {
    if (single) single.hidden = true;
    if (panel) panel.hidden = false;
    if (headline) headline.textContent = "Generating your panel review…";
    resetTrioCards();
    startTrioPoseCycle();
  } else {
    if (single) single.hidden = false;
    if (panel) panel.hidden = true;
    if (headline) headline.textContent = "Generating your full report…";
    const hero = document.getElementById("rex-hero");
    if (hero) hero.src = "/assets/rex.png";
    startHeroPoseCycle();
  }
  loader.hidden = false;
  startMessageCycle(tier);
}

export function hideGeneratingLoader() {
  const loader = document.getElementById("generating-loader");
  if (loader) loader.hidden = true;
  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.msg = loaderTimers.hero = loaderTimers.trio = null;
}

export function showLoaderError(tier, message) {
  const loader = document.getElementById("generating-loader");
  if (!loader) return;
  const card = loader.querySelector(".generating-card");
  const single = loader.querySelector('.rex-stage[data-mode="single"]');
  const panel = loader.querySelector('.rex-stage[data-mode="panel"]');
  const headline = document.getElementById("generating-headline");
  const status = document.getElementById("generating-status");
  const meta = document.getElementById("generating-meta");
  const actions = document.getElementById("generating-actions");

  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.msg = loaderTimers.hero = loaderTimers.trio = null;

  if (card) card.classList.add("is-error");
  if (headline) headline.textContent = "Something went wrong";
  if (status) {
    status.classList.remove("swapping");
    status.textContent = message || "We couldn't finish generating your report.";
  }
  if (meta) {
    meta.textContent =
      "Refreshing usually fixes it. If this keeps happening, contact support and include the job ID from the URL.";
  }
  if (actions) actions.hidden = false;

  if (tier === "panel") {
    if (single) single.hidden = true;
    if (panel) panel.hidden = false;
    document.querySelectorAll(".rex-trio-img").forEach((img) => {
      const trioCard = img.closest(".rex-trio-card");
      if (trioCard && !trioCard.classList.contains("is-done")) {
        img.src = "/assets/rex-concern.png";
      }
    });
  } else {
    if (single) single.hidden = false;
    if (panel) panel.hidden = true;
    const hero = document.getElementById("rex-hero");
    if (hero) {
      hero.src = "/assets/rex-concern.png";
      hero.classList.remove("swapping");
    }
  }

  loader.hidden = false;

  const retryBtn = document.getElementById("generating-retry");
  if (retryBtn) {
    retryBtn.onclick = () => window.location.reload();
  }
}

export function setPanelLoaderStatus(model, status) {
  const card = document.querySelector(`.rex-trio-card[data-model="${model}"]`);
  if (!card) return;
  const stateEl = card.querySelector(`[data-trio-state="${model}"]`);
  const img = card.querySelector(`[data-trio-img="${model}"]`);
  if (!stateEl) return;
  if (status === "running") {
    stateEl.textContent = "Reviewing…";
  } else if (status === "complete") {
    stateEl.textContent = "Done";
    card.classList.add("is-done");
    if (img) img.src = "/assets/rex-cheer.png";
  } else if (status === "error") {
    stateEl.textContent = "Failed";
    card.classList.remove("is-done");
  } else {
    stateEl.textContent = "Queued";
  }
}

function startMessageCycle(tier) {
  const messages = tier === "panel" ? PANEL_LOADER_MESSAGES : SINGLE_LOADER_MESSAGES;
  const statusEl = document.getElementById("generating-status");
  if (!statusEl) return;
  let idx = 0;
  statusEl.textContent = messages[0];
  statusEl.classList.remove("swapping");
  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  loaderTimers.msg = setInterval(() => {
    idx = (idx + 1) % messages.length;
    statusEl.classList.add("swapping");
    setTimeout(() => {
      statusEl.textContent = messages[idx];
      statusEl.classList.remove("swapping");
    }, 350);
  }, 4200);
}

function startHeroPoseCycle() {
  const hero = document.getElementById("rex-hero");
  if (!hero) return;
  let idx = 0;
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  loaderTimers.hero = setInterval(() => {
    idx = (idx + 1) % REX_POSES.length;
    hero.classList.add("swapping");
    setTimeout(() => {
      hero.src = REX_POSES[idx];
      hero.classList.remove("swapping");
    }, 350);
  }, 3500);
}

function startTrioPoseCycle() {
  const imgs = document.querySelectorAll(".rex-trio-img");
  if (!imgs.length) return;
  let tick = 0;
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.trio = setInterval(() => {
    imgs.forEach((img, i) => {
      const card = img.closest(".rex-trio-card");
      if (card && card.classList.contains("is-done")) return;
      const pose = REX_POSES[(tick + i) % REX_POSES.length];
      img.classList.add("swapping");
      setTimeout(() => {
        img.src = pose;
        img.classList.remove("swapping");
      }, 350);
    });
    tick++;
  }, 2800);
}

function resetTrioCards() {
  ["claude", "gpt", "gemini"].forEach((k) => {
    const card = document.querySelector(`.rex-trio-card[data-model="${k}"]`);
    if (card) card.classList.remove("is-done");
    const stateEl = document.querySelector(`[data-trio-state="${k}"]`);
    if (stateEl) stateEl.textContent = "Reading…";
  });
}

// renderFullReport(): copy the existing renderFullReport function from
// app.js verbatim into this module and export it. Same for the helpers it
// uses (renderFreePreview is upload-page-only and stays in app.js).
//
// renderPanelReport is split as renderPanelPane + renderReportHtml today;
// keep renderReportHtml here (used by both single + panel) and export
// renderPanelPane too.
//
// IMPORTANT: do NOT include functions that touch upload-page-specific state
// (state.jobId, state.stage1, state.stopJobPoll, etc). Pure rendering only.
// The implementer should grep for the function bodies in current app.js
// (Task 1.1 step 2 lists exactly which) and move them across, verbatim.
```

Detail: the actual render helpers (`renderFullReport`, `renderPanelPane`, `renderReportHtml`, `renderTermCell`) are 200+ lines that already exist in `js/app.js` and reference no upload-page state. Move them as-is into `js/render.js` and export. The implementer should use `grep -n` to locate each function in the current `app.js` and cut/paste each into `render.js`.

- [ ] **Step 2: Find each function to move**

Run `grep -n "^function \(renderFullReport\|renderPanelPane\|renderReportHtml\|renderTermCell\|riskColor\) " js/app.js` to get exact line numbers. These five functions plus the constants `REX_POSES`, `SINGLE_LOADER_MESSAGES`, `PANEL_LOADER_MESSAGES` and the `loaderTimers` state move to `render.js`. Everything else stays in `app.js`.

- [ ] **Step 3: Update `js/app.js` to import from `render.js`**

At the top of `js/app.js`, add:

```js
import {
  escapeHtml,
  escapeAttr,
  friendlyDeepError,
  showGeneratingLoader,
  hideGeneratingLoader,
  showLoaderError,
  setPanelLoaderStatus,
  renderFullReport,
  renderPanelPane,
} from "/js/render.js";
```

Delete the original definitions of those names from `app.js` so there's no duplicate symbol. Do NOT modify any call sites — they keep calling the same names, just now imported.

- [ ] **Step 4: Run typecheck and verify the upload page still works**

```
npx tsc --noEmit
```

Expected: no errors. (We don't typecheck `.js` files but `tsc --noEmit` runs the same checks the build does.)

Then:
- Open the dev server (preview_start "netlify" if not running).
- Visit `http://localhost:8888/`.
- Open DevTools console; verify no errors loading `app.js` or `render.js`.
- Drop a contract (no need to actually scan — just verify the upload UI works without errors).

- [ ] **Step 5: Commit**

```
git add js/render.js js/app.js
git commit -m "Extract shared rendering helpers into js/render.js

Pure render and loader-controller code is now in render.js so the
upcoming /r/<code> dashboard page can reuse it without copy-pasting
~250 lines from app.js. No behavior change on the upload page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.2: Add `recovery_code` column

**Files:**
- Modify: `db/schema.ts`
- Create: `netlify/database/migrations/<ts>_recovery_codes/migration.sql`

- [ ] **Step 1: Generate migration timestamp**

```
date -u +"%Y%m%d%H%M%S"
```

Use the resulting string in the directory name (e.g. `20260509120000_recovery_codes`).

- [ ] **Step 2: Write the migration SQL**

```sql
-- netlify/database/migrations/<ts>_recovery_codes/migration.sql
ALTER TABLE "checkout_sessions" ADD COLUMN "recovery_code" text;
CREATE UNIQUE INDEX "checkout_sessions_recovery_code_idx"
  ON "checkout_sessions" ("recovery_code");
```

Note: the column is nullable (existing rows have no code). The unique index allows multiple NULLs in PostgreSQL.

- [ ] **Step 3: Update `db/schema.ts`**

In the `checkoutSessions` table definition, add:

```ts
recoveryCode: text("recovery_code").unique(),
```

right after `polarCheckoutId` to keep the field grouping logical.

- [ ] **Step 4: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add db/schema.ts netlify/database/migrations
git commit -m "Add recovery_code column to checkout_sessions

Short URL-safe code used in /r/<code> shareable URLs. Auto-applied
on Netlify deploy.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.3: Helper for generating recovery codes

**Files:**
- Create: `netlify/lib/recovery-code.ts`

Pure function, easy to unit-test inline.

- [ ] **Step 1: Write the helper**

```ts
// netlify/lib/recovery-code.ts
import { randomBytes } from "node:crypto";

// 12-char URL-safe code (~72 bits of entropy). Suitable for shareable URLs:
// not guessable, not embarrassing-looking, fits in a tweet.
export function generateRecoveryCode(): string {
  return randomBytes(9).toString("base64url");
}

export function isValidRecoveryCode(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{12}$/.test(s);
}
```

- [ ] **Step 2: Inline test**

Run:

```
npx tsx -e "
import { generateRecoveryCode, isValidRecoveryCode } from './netlify/lib/recovery-code.ts';
const codes = new Set();
for (let i = 0; i < 1000; i++) codes.add(generateRecoveryCode());
console.log('Distinct in 1000:', codes.size);          // expect 1000
const c = generateRecoveryCode();
console.log('Length:', c.length);                       // expect 12
console.log('Valid:', isValidRecoveryCode(c));          // expect true
console.log('Reject empty:', isValidRecoveryCode(''));  // expect false
console.log('Reject hex:', isValidRecoveryCode('0123456789ab')); // expect true (still matches)
console.log('Reject special:', isValidRecoveryCode('a/b'));      // expect false
"
```

Expected output:
- `Distinct in 1000: 1000`
- `Length: 12`
- `Valid: true`
- `Reject empty: false`
- `Reject special: false`

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
git add netlify/lib/recovery-code.ts
git commit -m "Add recovery-code helper (generate + validate)

12-char URL-safe codes for /r/<code> shareable URLs. ~72 bits of
entropy via randomBytes(9).toString('base64url').

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.4: Wire `recovery_code` into checkout creation

**Files:**
- Modify: `netlify/functions/checkout-init.mts`
- Modify: `netlify/functions/redeem-coupon.mts`

- [ ] **Step 1: Update `checkout-init.mts`**

Add the import:

```ts
import { generateRecoveryCode } from "../lib/recovery-code.js";
```

Modify the session insert to include `recoveryCode`. Replace the existing `db.insert(checkoutSessions).values({...}).returning()` block with:

```ts
const recoveryCode = generateRecoveryCode();
const [session] = await db
  .insert(checkoutSessions)
  .values({
    jobId,
    tier,
    status: "pending",
    recoveryCode,
  })
  .returning();
```

Also add `recovery_code` to the response body returned to the client:

```ts
return Response.json({
  session_id: session.id,
  recovery_code: recoveryCode,
  // ... existing fields
});
```

- [ ] **Step 2: Update `redeem-coupon.mts` similarly**

Add the import (same line) and modify the session insert to include `recoveryCode: generateRecoveryCode()`. Add `recovery_code` to the response JSON.

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```

- [ ] **Step 4: Test against local dev**

```
curl -s -X POST -H "Content-Type: application/json" \
  http://localhost:8888/api/redeem-coupon \
  -d '{"job_id":"00000000-0000-0000-0000-000000000000","tier":"single","code":"FREE"}' \
  | grep -o '"recovery_code":"[^"]*"'
```

Expected: `"recovery_code":"<12 chars>"` (the job lookup will still 404 because the test job doesn't exist; that's fine — we just want to confirm the field is in the response shape).

Actually since validation runs before job lookup, the request will fail at "Job not found" with a 404. Try a valid job: drop a contract via the UI first to get a real `job_id`, then re-run with that.

- [ ] **Step 5: Commit**

```
git add netlify/functions/checkout-init.mts netlify/functions/redeem-coupon.mts
git commit -m "Generate recovery_code on checkout-init and redeem-coupon

Each new checkout session now gets a 12-char URL-safe code that maps
to the /r/<code> dashboard URL. Returned in the API response so the
frontend can redirect after payment / coupon redemption.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.5: New `/api/r/:code` resolver endpoint

**Files:**
- Create: `netlify/functions/r-resolve.mts`

This endpoint takes the recovery code, verifies it, and returns the same data shape `/api/report` returns today (so the dashboard can use the same render code). It also issues a fresh signed download token so the dashboard can fetch the PDF.

- [ ] **Step 1: Write the function**

```ts
// netlify/functions/r-resolve.mts
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs, checkoutSessions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/token.js";
import { isValidRecoveryCode } from "../lib/recovery-code.js";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    const code = segs[segs.length - 1];

    if (!isValidRecoveryCode(code)) {
      return Response.json({ error: "Invalid code" }, { status: 400 });
    }

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.recoveryCode, code));
    if (!session) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, session.jobId));
    if (!job) {
      return Response.json({ error: "Job missing" }, { status: 404 });
    }

    const paid = session.status === "paid";
    const downloadToken = paid ? signToken(session.id) : null;

    const response: Record<string, unknown> = {
      code,
      job_id: job.id,
      session_id: session.id,
      tier: session.tier,
      paid,
      method: session.method,
      paid_at: session.paidAt,
      created_at: session.createdAt,
      download_token: downloadToken,
      stage1: {
        status: job.stage1Status,
        result: job.stage1Result,
        error: job.stage1Error,
      },
    };

    if (paid && session.tier === "single") {
      response.stage2 = {
        status: job.stage2Status,
        result: job.stage2Result,
        error: job.stage2Error,
        pdf_available: !!job.reportBlobKey,
      };
    } else {
      response.stage2 = {
        status: job.stage2Status,
        ready: job.stage2Status === "complete",
      };
    }

    if (paid && session.tier === "panel") {
      response.panel = {
        claude: {
          status: job.panelClaudeStatus,
          result: job.panelClaudeResult,
          error: job.panelClaudeError,
          model: "claude-opus-4-7",
          pdf_available: !!job.panelClaudeBlobKey,
        },
        gpt: {
          status: job.panelGptStatus,
          result: job.panelGptResult,
          error: job.panelGptError,
          model: "gpt-5.5-pro",
          pdf_available: !!job.panelGptBlobKey,
        },
        gemini: {
          status: job.panelGeminiStatus,
          result: job.panelGeminiResult,
          error: job.panelGeminiError,
          model: "gemini-2.5-pro",
          pdf_available: !!job.panelGeminiBlobKey,
        },
      };
    } else {
      response.panel = {
        claude: { status: job.panelClaudeStatus },
        gpt: { status: job.panelGptStatus },
        gemini: { status: job.panelGeminiStatus },
      };
    }

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("/api/r/:code failed:", msg);
    return Response.json(
      { error: "Server error", detail: msg },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/r/:code",
};
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

- [ ] **Step 3: Test against local dev**

Drop a contract via the UI to create a job, then redeem `FREE` to get a `recovery_code` from the response. Then:

```
curl -s "http://localhost:8888/api/r/<code>" | head -c 500
```

Expected: JSON containing `code`, `job_id`, `paid: true`, `tier`, `download_token`, `stage1`, `stage2`, etc.

Also verify rejection cases:

```
curl -s "http://localhost:8888/api/r/notarealcode" -w "\n%{http_code}\n"
```

Expected: status 400 (invalid format) for too-short / wrong-shape codes, status 404 for valid-shape-but-unknown codes.

- [ ] **Step 4: Commit**

```
git add netlify/functions/r-resolve.mts
git commit -m "Add /api/r/:code resolver endpoint

Takes a recovery code, validates shape, looks up the checkout session,
returns the same shape /api/report returns today plus a freshly-signed
download_token. Foundation for the upcoming /r/<code> dashboard page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.6: Push Phase 1

- [ ] **Step 1: Push to main**

```
git push origin main
```

Wait for Netlify deploy to finish. Migration auto-applies.

- [ ] **Step 2: Smoke-test the deploy**

After deploy lands, on production:

```
curl -s "https://trexlawyer.com/api/r/notarealcode12" -w "\n%{http_code}\n"
```

Expected: 404 with `{"error":"Not found"}` (or 400 if invalid shape). Either way, the function exists and the migration applied (otherwise we'd see a "column does not exist" error).

---

## Phase 2 — Dashboard shell (`/r/<code>`)

Phase 2 is shippable on its own: visiting `/r/<code>` works for any session that has a recovery code, but the existing payment flow still redirects to `/?paid=1` (we change that in Phase 4).

### Task 2.1: `r.html` skeleton + Netlify routing

**Files:**
- Create: `r.html`
- Modify: `netlify.toml`

- [ ] **Step 1: Create `r.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your TREC Report — T-REX Lawyer</title>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="icon" href="/assets/icon-texas.svg" />
  </head>
  <body class="r-page">
    <header class="r-header">
      <a href="/" class="r-logo">
        <span class="logo-mark"></span>
        <span class="logo-text">T-REX LAWYER</span>
      </a>
    </header>

    <main class="r-main">
      <section class="r-disclaimer" id="r-disclaimer">
        <strong>This URL is your login.</strong>
        Anyone with it can see this report. We don't store personal info
        beyond what's in the contract data.
      </section>

      <section class="r-share">
        <label class="r-share-label">Save or share this URL</label>
        <div class="r-share-row">
          <input
            id="r-share-input"
            class="r-share-input"
            readonly
            value=""
          />
          <button class="btn primary" id="r-share-copy">📋 Copy</button>
        </div>
      </section>

      <nav class="r-tabs" id="r-tabs">
        <button class="r-tab active" data-tab="report">📄 Full Report</button>
        <button class="r-tab" data-tab="overlay">🔍 Visual Overlay</button>
        <button class="r-tab" data-tab="chat">💬 Chat</button>
      </nav>

      <section class="r-tab-pane" data-pane="report">
        <!-- Loader + report content render here. -->
        <div id="r-report-content"></div>
      </section>
      <section class="r-tab-pane" data-pane="overlay" hidden>
        <div id="r-overlay-content"></div>
      </section>
      <section class="r-tab-pane" data-pane="chat" hidden>
        <div id="r-chat-content"></div>
      </section>

      <footer class="r-footer-meta" id="r-meta"></footer>
    </main>

    <!-- Reuse the same loader markup from index.html. -->
    <section id="generating-loader" class="generating-loader" hidden>
      <!-- (paste the entire <section id="generating-loader"> contents from
           index.html here, verbatim — same DOM structure so render.js
           controller works identically) -->
    </section>

    <script type="module" src="/js/r.js"></script>
  </body>
</html>
```

For the loader markup placeholder, copy the full `<section id="generating-loader">` block from `index.html` (find it with `grep -n "id=\"generating-loader\"" index.html`). It's roughly 50 lines.

- [ ] **Step 2: Add the redirect to `netlify.toml`**

Append to `netlify.toml`:

```toml
[[redirects]]
  from = "/r/*"
  to = "/r.html"
  status = 200
```

Status 200 = serve `r.html` while keeping the URL the user visited. The frontend reads the path to extract the code.

- [ ] **Step 3: Verify routing**

Restart `netlify dev` if needed, then:

```
curl -sI "http://localhost:8888/r/h7F2pXq9LkN4" | head -5
```

Expected: `HTTP/1.1 200 OK` with content-type `text/html`.

- [ ] **Step 4: Commit**

```
git add r.html netlify.toml
git commit -m "Add r.html dashboard shell + /r/* routing

Static page served for any /r/<code> URL. Frontend (added next task)
reads the code from window.location and fetches state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.2: Page styles

**Files:**
- Modify: `styles.css`

Add layout for the dashboard. Most existing styles (tabs, buttons, panels) we already have; we just need a few new pieces.

- [ ] **Step 1: Append dashboard styles to `styles.css`**

```css
/* Standalone /r/<code> dashboard */
.r-page {
  background: #FFFFFF;
  min-height: 100vh;
}
.r-header {
  padding: 22px 32px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.r-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--slate);
}
.r-main {
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 24px 80px;
}
.r-disclaimer {
  background: #FFF8EE;
  border: 1px solid #F5DDB6;
  color: #8B5A18;
  border-radius: 12px;
  padding: 14px 18px;
  font-size: 13.5px;
  line-height: 1.5;
  margin-bottom: 24px;
}
.r-disclaimer strong { color: #6B4310; }

.r-share {
  margin-bottom: 28px;
}
.r-share-label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.r-share-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.r-share-input {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: #FAFBFD;
  color: var(--slate);
  min-width: 0;
}
.r-share-input:focus { outline: none; border-color: var(--blue); background: #fff; }

.r-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--hair);
  margin-bottom: 24px;
}
.r-tab {
  background: none;
  border: 0;
  padding: 12px 20px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.r-tab:hover { color: var(--slate); }
.r-tab.active {
  color: var(--blue);
  border-bottom-color: var(--blue);
  font-weight: 600;
}
.r-tab[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}

.r-tab-pane[hidden] { display: none; }

.r-footer-meta {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px dashed var(--hair);
  color: var(--muted);
  font-size: 12.5px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}

.r-paid-toast {
  background: #E8F5E8;
  border: 1px solid #B5D8B5;
  color: #1B6E3D;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13.5px;
  margin-bottom: 16px;
  animation: r-toast-in 0.4s ease;
}
@keyframes r-toast-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Visual sanity check**

Start preview server, visit `http://localhost:8888/r/anycodexxxxx`. The page renders blank for now (no JS yet) but you should see:
- White background
- Logo top-left
- Disclaimer banner (orange-tinted)
- Empty share input
- Three tabs

- [ ] **Step 3: Commit**

```
git add styles.css
git commit -m "Style the standalone /r/<code> dashboard

White-bg layout, share-URL input, tab system, disclaimer banner,
paid-toast animation. Reuses the same blue/hair tokens as the upload
page so it feels like the same product.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.3: `js/r.js` controller — resolve + render skeleton

**Files:**
- Create: `js/r.js`

This is the main dashboard controller. It reads the URL, resolves via `/api/r/:code`, sets up tab switching, renders the share field, and dispatches to the active tab.

- [ ] **Step 1: Write the controller**

```js
// js/r.js — standalone /r/<code> dashboard controller.
//
// Reads the code from the URL path, fetches /api/r/:code, then drives
// tab switching and per-tab rendering. PDF rasterization for the
// overlay tab is lazy-imported (./r-overlay.js) on first click.

import {
  showGeneratingLoader,
  hideGeneratingLoader,
  showLoaderError,
  setPanelLoaderStatus,
  renderFullReport,
  renderPanelPane,
  friendlyDeepError,
  escapeHtml,
} from "/js/render.js";

const $ = (id) => document.getElementById(id);

const state = {
  code: null,
  data: null,
  jobId: null,
  downloadToken: null,
  tier: null,
  panelStatus: { claude: "pending", gpt: "pending", gemini: "pending" },
  panelResults: { claude: null, gpt: null, gemini: null },
  stopJobPoll: null,
  activeTab: "report",
  overlayLoaded: false,
  chatLoaded: false,
};

init();

async function init() {
  // 1) Pull the code out of /r/<code> (or /r/<code>?paid=1)
  const segs = window.location.pathname.split("/").filter(Boolean);
  const code = segs[1] || null;
  if (!code) {
    renderFatal("This URL doesn't look like a valid report URL.");
    return;
  }
  state.code = code;
  setShareUrl(code);

  // 2) Show paid toast if this is a fresh redirect from Polar
  const params = new URLSearchParams(window.location.search);
  if (params.get("paid") === "1") {
    showPaidToast();
    // Strip the query param so reloads don't re-show the toast
    history.replaceState({}, "", "/r/" + encodeURIComponent(code));
  }

  // 3) Wire up tab switching + share copy
  setupTabs();
  setupShareCopy();

  // 4) Resolve via /api/r/:code
  let data;
  try {
    const res = await fetch("/api/r/" + encodeURIComponent(code));
    if (res.status === 404) {
      renderFatal("This report URL was not found. Double-check the code in the URL.");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to load report (" + res.status + ")");
    }
    data = await res.json();
  } catch (err) {
    showLoaderError("single", err.message || "Failed to load report.");
    insertLoaderInto("r-report-content");
    return;
  }

  state.data = data;
  state.jobId = data.job_id;
  state.downloadToken = data.download_token;
  state.tier = data.tier;
  if (data.panel) {
    state.panelStatus = {
      claude: data.panel.claude?.status || "pending",
      gpt: data.panel.gpt?.status || "pending",
      gemini: data.panel.gemini?.status || "pending",
    };
  }

  // 5) Render footer metadata + tab gating
  renderFooterMeta(data);
  gateOverlayTab(data);

  // 6) Render the active (default: report) tab
  renderReportTab();
}

function setShareUrl(code) {
  const url = window.location.origin + "/r/" + code;
  $("r-share-input").value = url;
}

function setupShareCopy() {
  const btn = $("r-share-copy");
  const input = $("r-share-input");
  if (!btn || !input) return;
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {
      input.select();
      input.setSelectionRange(0, input.value.length);
    }
  };
  input.onclick = () => { input.select(); };
}

function setupTabs() {
  document.querySelectorAll(".r-tab").forEach((btn) => {
    btn.onclick = () => {
      if (btn.hasAttribute("disabled")) return;
      const which = btn.dataset.tab;
      activateTab(which);
    };
  });
}

function activateTab(which) {
  state.activeTab = which;
  document.querySelectorAll(".r-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === which),
  );
  document.querySelectorAll(".r-tab-pane").forEach((p) =>
    p.hidden = p.dataset.pane !== which,
  );
  if (which === "overlay") loadOverlayTab();
  if (which === "chat") loadChatTab();
}

function gateOverlayTab(data) {
  const formId = data.stage1?.result?.form_id;
  const overlayBtn = document.querySelector('.r-tab[data-tab="overlay"]');
  if (!overlayBtn) return;
  if (formId !== "20-18") {
    overlayBtn.setAttribute("disabled", "");
    overlayBtn.title = "Visual overlay coming soon for this form.";
  } else {
    overlayBtn.removeAttribute("disabled");
    overlayBtn.title = "";
  }
}

function showPaidToast() {
  const toast = document.createElement("div");
  toast.className = "r-paid-toast";
  toast.textContent = "✓ Payment confirmed. Your report is being generated.";
  $("r-share").parentNode.insertBefore(toast, $("r-share"));
  setTimeout(() => toast.remove(), 8000);
}

function renderFooterMeta(data) {
  const meta = $("r-meta");
  if (!meta) return;
  const tier = data.tier === "panel" ? "Panel review" : data.tier === "single" ? "Single review" : "—";
  const stage1 = data.stage1?.result || {};
  const formLabel = stage1.form_id
    ? `TREC ${stage1.form_id}` + (stage1.form_name ? ` · ${escapeHtml(stage1.form_name)}` : "")
    : "TREC form";
  const pages = stage1.page_count ? `${stage1.page_count} pages` : "";
  const mods = typeof stage1.modification_count === "number"
    ? `${stage1.modification_count} modification${stage1.modification_count === 1 ? "" : "s"} flagged`
    : "";
  const paid = data.paid_at
    ? `Paid ${new Date(data.paid_at).toLocaleDateString()}`
    : "Not yet paid";
  meta.innerHTML = `
    <span>Tier: ${escapeHtml(tier)}</span>
    <span>${paid}</span>
    <span>Form: ${formLabel}${pages ? ` · ${pages}` : ""}${mods ? ` · ${mods}` : ""}</span>
  `;
}

function renderFatal(msg) {
  document.querySelector(".r-main").innerHTML =
    `<div class="r-disclaimer" style="background:#FDECEC;border-color:#F5C6C6;color:#8B1A1A">${escapeHtml(msg)}</div>`;
}

function insertLoaderInto(targetId) {
  // Move the loader element into the requested pane so it appears inline.
  const loader = $("generating-loader");
  const target = $(targetId);
  if (loader && target) target.appendChild(loader);
}

// --- Report tab ---
function renderReportTab() {
  const target = $("r-report-content");
  if (!state.data) return;
  if (!state.data.paid) {
    target.innerHTML = `
      <div class="r-disclaimer" style="background:#FFF;border:1px solid var(--hair);color:var(--slate)">
        This URL is for an unpaid report. Return to <a href="/">trexlawyer.com</a> to upload again.
      </div>`;
    return;
  }

  // Single tier
  if (state.tier === "single") {
    const result = state.data.stage2?.result;
    if (result) {
      target.innerHTML = singleReportHtml();
      renderFullReport(result);
      const dl = target.querySelector(".r-download-pdf");
      if (dl) dl.href = pdfUrl();
      hideGeneratingLoader();
    } else if (state.data.stage2?.status === "error") {
      insertLoaderInto("r-report-content");
      showLoaderError("single", friendlyDeepError(state.data.stage2.error));
    } else {
      insertLoaderInto("r-report-content");
      showGeneratingLoader("single");
      startPolling();
    }
    return;
  }

  // Panel tier
  if (state.tier === "panel") {
    const anyResult =
      state.data.panel?.claude?.result ||
      state.data.panel?.gpt?.result ||
      state.data.panel?.gemini?.result;
    if (anyResult) {
      target.innerHTML = panelReportHtml();
      paintPanelResults(state.data);
      hideGeneratingLoader();
      const allError = ["claude","gpt","gemini"].every(k => state.panelStatus[k] === "error");
      if (!["claude","gpt","gemini"].every(k =>
        state.panelStatus[k] === "complete" || state.panelStatus[k] === "error"
      )) {
        startPolling();
      }
    } else {
      insertLoaderInto("r-report-content");
      showGeneratingLoader("panel");
      startPolling();
    }
  }
}

function singleReportHtml() {
  return `
    <div class="full-report-actions">
      <a class="btn primary r-download-pdf" target="_blank" rel="noopener">Download PDF</a>
    </div>
    <h3>Summary</h3>
    <p id="report-summary"></p>
    <h3>Modifications</h3>
    <div id="report-mods"></div>
    <h3>Full Terms</h3>
    <table id="report-terms"></table>
  `;
}

function panelReportHtml() {
  return `
    <div class="panel-tabs" id="panel-tabs">
      <button class="panel-tab active" data-panel="claude">
        <span class="panel-tab-name">Claude Opus 4.7</span>
        <span class="panel-tab-state" data-tab-state="claude">Loading…</span>
      </button>
      <button class="panel-tab" data-panel="gpt">
        <span class="panel-tab-name">GPT-5.5 Pro</span>
        <span class="panel-tab-state" data-tab-state="gpt">Loading…</span>
      </button>
      <button class="panel-tab" data-panel="gemini">
        <span class="panel-tab-name">Gemini 2.5 Pro</span>
        <span class="panel-tab-state" data-tab-state="gemini">Loading…</span>
      </button>
    </div>
    <div class="panel-pane" data-pane="claude">
      <div class="panel-pane-loading">Claude is still drafting its review…</div>
      <a class="btn primary panel-download" data-download="claude" hidden target="_blank" rel="noopener">
        Download Claude's review (PDF)
      </a>
      <div class="panel-pane-content" hidden></div>
    </div>
    <div class="panel-pane" data-pane="gpt" hidden>
      <div class="panel-pane-loading">GPT-5.5 Pro is still drafting its review…</div>
      <a class="btn primary panel-download" data-download="gpt" hidden target="_blank" rel="noopener">
        Download GPT's review (PDF)
      </a>
      <div class="panel-pane-content" hidden></div>
    </div>
    <div class="panel-pane" data-pane="gemini" hidden>
      <div class="panel-pane-loading">Gemini 2.5 Pro is still drafting its review…</div>
      <a class="btn primary panel-download" data-download="gemini" hidden target="_blank" rel="noopener">
        Download Gemini's review (PDF)
      </a>
      <div class="panel-pane-content" hidden></div>
    </div>
  `;
}

function paintPanelResults(data) {
  document.querySelectorAll(".panel-tab").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".panel-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const which = btn.dataset.panel;
      document.querySelectorAll(".panel-pane").forEach((p) => p.hidden = p.dataset.pane !== which);
    };
  });

  ["claude", "gpt", "gemini"].forEach((k) => {
    const result = data.panel[k]?.result;
    if (result && !state.panelResults[k]) {
      state.panelResults[k] = result;
      renderPanelPane(k, result);
    }
    const pdfReady = !!data.panel[k]?.pdf_available;
    const dl = document.querySelector(`.panel-download[data-download="${k}"]`);
    if (dl) {
      if (pdfReady) {
        dl.href = pdfUrl(k);
        dl.hidden = false;
      } else {
        dl.hidden = true;
        dl.removeAttribute("href");
      }
    }
    setPanelLoaderStatus(k, state.panelStatus[k]);
  });
  updatePanelTabStateLabels();
}

function updatePanelTabStateLabels() {
  ["claude", "gpt", "gemini"].forEach((k) => {
    const stateEl = document.querySelector(`[data-tab-state="${k}"]`);
    if (!stateEl) return;
    const status = state.panelStatus[k];
    stateEl.className = `panel-tab-state ${status}`;
    stateEl.textContent =
      status === "complete" ? "Done"
        : status === "running" ? "Reviewing…"
          : status === "error" ? "Failed"
            : "Queued";
  });
}

function pdfUrl(model) {
  const base =
    "/api/report?id=" + encodeURIComponent(state.jobId) +
    "&token=" + encodeURIComponent(state.downloadToken) +
    "&format=pdf";
  return model ? base + "&model=" + model : base;
}

// --- Polling ---
// /api/r/<code> is keyed on the recovery code, not the session_id, so we
// can't reuse the existing pollCheckoutStatus helper. Hand-roll the loop.
function startPolling() {
  if (state.stopJobPoll) return;
  state.stopJobPoll = pollResolveLoop();
}

function pollResolveLoop() {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/r/" + encodeURIComponent(state.code));
      if (res.ok) {
        const data = await res.json();
        state.data = data;
        if (data.panel) {
          state.panelStatus = {
            claude: data.panel.claude?.status || "pending",
            gpt: data.panel.gpt?.status || "pending",
            gemini: data.panel.gemini?.status || "pending",
          };
        }
        // Single ready
        if (state.tier === "single" && data.stage2?.result) {
          stopped = true;
          renderReportTab();
          return;
        }
        // Single error
        if (state.tier === "single" && data.stage2?.status === "error") {
          stopped = true;
          showLoaderError("single", friendlyDeepError(data.stage2.error));
          return;
        }
        // Panel: any result triggers re-render; loop continues until all done
        if (state.tier === "panel") {
          const anyResult =
            data.panel?.claude?.result ||
            data.panel?.gpt?.result ||
            data.panel?.gemini?.result;
          if (anyResult) {
            renderReportTab();
          }
          const allDone = ["claude","gpt","gemini"].every((k) =>
            state.panelStatus[k] === "complete" || state.panelStatus[k] === "error"
          );
          if (allDone) {
            stopped = true;
            return;
          }
          const allError = ["claude","gpt","gemini"].every((k) => state.panelStatus[k] === "error");
          if (allError) {
            stopped = true;
            showLoaderError(
              "panel",
              "All three reviews failed to generate. Try again, or pay for a single report instead."
            );
            return;
          }
        }
      }
    } catch (err) {
      // Transient: keep polling.
      console.warn("poll tick failed:", err);
    }
    setTimeout(tick, 2500);
  };
  tick();
  return () => { stopped = true; };
}

// --- Lazy tab loaders (filled in by Phase 5 + Phase 2.4) ---
async function loadOverlayTab() {
  if (state.overlayLoaded) return;
  state.overlayLoaded = true;
  const target = $("r-overlay-content");
  target.innerHTML = `<div class="overlay-placeholder">Overlay viewer is being built — coming soon.</div>`;
  // In Phase 5: replaced with `import("/js/r-overlay.js").then(m => m.mount(target, state))`.
}

async function loadChatTab() {
  if (state.chatLoaded) return;
  state.chatLoaded = true;
  const target = $("r-chat-content");
  target.innerHTML = `<div class="chat-placeholder">Chat is being wired up — coming soon.</div>`;
  // In Phase 2.5: load existing chat widget into target.
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

- [ ] **Step 3: Visual + functional verification**

Drop a contract on `/`, redeem `FREE` (after Phase 1.4 lands), grab the `recovery_code` from the network response, then visit `http://localhost:8888/r/<code>`.

Expected:
- White page renders with logo, disclaimer banner, share input populated
- Three tabs visible; only Full Report is active
- Loader appears below the tab if work is still running
- When stage2 completes, the report content fades in

If the request to `/api/r/<code>` returns a 500 about missing `recovery_code` column, the local dev DB hasn't applied Phase 1.2's migration. Apply it manually for dev:

```
netlify db connect --query 'ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "recovery_code" text;
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_recovery_code_idx" ON "checkout_sessions" ("recovery_code");'
```

- [ ] **Step 4: Commit**

```
git add js/r.js
git commit -m "Add /r/<code> dashboard controller (report + chat shells)

Reads code from URL, fetches /api/r/<code>, drives tab switching,
renders the share field, paints the Full Report tab using the same
render.js helpers as the upload page. Polls /api/r/<code> every 2.5s
while work is incomplete; transitions to results when ready.
Overlay and Chat tabs are placeholder stubs filled in later.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.4: Wire the Chat tab

**Files:**
- Modify: `js/r.js`

The existing chat widget is in `js/chat.js` and is initialized on the upload page. Look at how it's initialized and replicate inside the dashboard.

- [ ] **Step 1: Inspect the existing chat init**

```
grep -n "chat\|setupChat\|chatWidget" js/app.js js/chat.js | head -20
```

Identify the entry point. It's likely a `setupChat()` or `init()` that takes a `job_id` and a container element.

- [ ] **Step 2: Update `loadChatTab()` in `js/r.js`**

Replace the placeholder body with:

```js
async function loadChatTab() {
  if (state.chatLoaded) return;
  state.chatLoaded = true;
  const target = $("r-chat-content");
  if (!state.jobId) {
    target.innerHTML = `<p class="rich-foot-note">Chat unavailable — job not yet resolved.</p>`;
    return;
  }
  try {
    // Lazy-import the existing chat widget. The exact import shape
    // depends on chat.js's exports — adjust based on what step 1 found.
    const chat = await import("/js/chat.js");
    if (typeof chat.mountChat === "function") {
      chat.mountChat(target, { jobId: state.jobId });
    } else if (typeof chat.default === "function") {
      chat.default(target, { jobId: state.jobId });
    } else {
      throw new Error("chat.js doesn't export a mount function");
    }
  } catch (err) {
    target.innerHTML =
      `<p class="rich-foot-note error">Couldn't load chat: ${err.message}</p>`;
  }
}
```

If `chat.js` doesn't currently export a mount function (it just initializes against fixed DOM IDs), wrap the existing init logic in an exported function. The minimum change in `chat.js`:

```js
export function mountChat(container, opts) {
  // (paste existing chat init logic here, using `container` and
  //  `opts.jobId` as the parameters)
}
```

- [ ] **Step 3: Verify**

Visit `/r/<code>` for a paid session, click the Chat tab. Expected: chat widget renders inside the pane and accepts a question.

If it doesn't work because the widget is hard-coded to certain DOM IDs that don't exist on `r.html`, add those IDs to `r.html` inside `<div id="r-chat-content">`.

- [ ] **Step 4: Commit**

```
git add js/r.js js/chat.js
git commit -m "Mount chat widget in /r/<code> dashboard's Chat tab

Lazy-import on first click, reuses the same chat-stream backend with
the resolved job_id. No new server-side changes — chat-stream already
takes job_id as input.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.5: Push Phase 2

- [ ] **Step 1: Push**

```
git push origin main
```

- [ ] **Step 2: Smoke test**

After deploy, on production:
1. Drop a contract on `/`.
2. Redeem `FREE` to make a paid session. The redemption response now includes a `recovery_code`.
3. Visit `https://trexlawyer.com/r/<code>` directly.
4. Expected: dashboard renders, loader plays during AI work, report fades in when ready.

The upload page's `/?paid=1&session_id=X` flow still works the old way — Phase 4 redirects it to `/r/<code>`.

---

## Phase 3 — Polar pre-warming

Phase 3 is an upload-page-only optimization. No new pages, no new endpoints, just frontend caching of two `/api/checkout-init` calls.

### Task 3.1: Pre-warm checkouts after quick scan

**Files:**
- Modify: `js/app.js`
- Modify: `js/checkout.js`

- [ ] **Step 1: Add the pre-warm hook in `app.js`**

Find where the quick-scan completion is handled (look for `s1 === "complete"` and the rendering of the rich preview). Right after the rich preview renders, kick off pre-warming:

```js
// Pre-warm Polar checkouts in the background so Pay feels instant.
// Don't await — we want to keep rendering the preview while these load.
import { prewarmCheckouts } from "/js/checkout.js";
// ... inside the polling onSuccess for s1 === "complete" ...
if (state.jobId) prewarmCheckouts(state.jobId);
```

The exact import line goes at the top of `app.js`. The `prewarmCheckouts` call goes at the moment the rich preview is first painted (one-time per job, not on every poll tick).

- [ ] **Step 2: Implement `prewarmCheckouts` in `checkout.js`**

At the top of `js/checkout.js`, add module state:

```js
const PREWARM_TTL_MS = 30 * 60 * 1000;
const prewarm = { single: null, panel: null }; // { url, sessionId, recoveryCode, expiresAt }
```

And export the function:

```js
export function prewarmCheckouts(jobId) {
  ["single", "panel"].forEach((tier) => {
    if (prewarm[tier] && prewarm[tier].expiresAt > Date.now()) return; // still valid
    fetch("/api/checkout-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, tier }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data || !data.polar_checkout_url) return;
        prewarm[tier] = {
          url: data.polar_checkout_url,
          sessionId: data.session_id,
          recoveryCode: data.recovery_code,
          expiresAt: Date.now() + PREWARM_TTL_MS,
        };
      })
      .catch((err) => {
        console.warn("prewarm " + tier + " failed:", err);
      });
  });
}
```

- [ ] **Step 3: Use the pre-warmed URL in `openCheckout`**

In `openCheckout(jobId, tier, onPaid, onError)`, before the existing `fetch("/api/checkout-init", ...)` call, check the cache:

```js
let initData = null;

const cached = prewarm[tier];
if (cached && cached.expiresAt > Date.now()) {
  initData = {
    session_id: cached.sessionId,
    polar_checkout_url: cached.url,
    recovery_code: cached.recoveryCode,
    tier,
    price_usd: tier === "panel" ? 12 : 5,
    polar_checkout_id: null, // not used downstream
    ln_available: false,     // pre-warm doesn't include LN; LN tab still works lazily
  };
  // Invalidate after first use — Polar checkouts are single-use.
  prewarm[tier] = null;
}

if (!initData) {
  // (existing fetch + error handling, unchanged)
}
```

- [ ] **Step 4: Verify in dev**

1. Restart `netlify dev` to pick up the new code.
2. Drop a contract on `/`.
3. After the rich preview renders, open DevTools → Network. Look for two parallel `POST /api/checkout-init` calls. Both should succeed with 200.
4. Click "Unlock full report". The Polar overlay should open noticeably faster than before — no `/api/checkout-init` call in DevTools because it used the cache.

- [ ] **Step 5: Commit**

```
git add js/app.js js/checkout.js
git commit -m "Pre-warm Polar checkouts after quick-scan finishes

Two parallel /api/checkout-init calls (single + panel) fire as soon
as the free preview renders. URLs are cached for 30 min; click to Pay
opens the Polar overlay instantly with the cached URL. Falls through
to live /api/checkout-init if the cache misses.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3.2: Push Phase 3

- [ ] **Step 1: Push**

```
git push origin main
```

- [ ] **Step 2: Verify on production**

Drop a contract → wait for preview → click Unlock. The Polar overlay should now open in <500ms. Compare to pre-deploy baseline (3-4s).

---

## Phase 4 — Redirect new payments to `/r/<code>`

Phase 4 changes Polar's `success_url` and the coupon-redemption flow to land on `/r/<code>` instead of `/?paid=1&session_id=X`.

### Task 4.1: Update Polar `success_url`

**Files:**
- Modify: `netlify/functions/checkout-init.mts`

- [ ] **Step 1: Build `successUrl` from `recoveryCode`**

Replace the existing successUrl line with:

```ts
const successUrl = origin
  ? `${origin}/r/${recoveryCode}?paid=1`
  : undefined;
```

(Note: at this point in the function, `recoveryCode` is already in scope from Task 1.4.)

- [ ] **Step 2: Typecheck + smoke test**

```
npx tsc --noEmit
```

Locally, drop and pay (use FREE for testing — but FREE doesn't go through Polar). For the live Polar path, this can only be verified once deployed: test with a real Polar checkout (test mode), confirm the success redirect lands on `/r/<code>?paid=1`.

- [ ] **Step 3: Commit**

```
git add netlify/functions/checkout-init.mts
git commit -m "Redirect Polar success to /r/<code>?paid=1

Replaces the /?paid=1&session_id=X redirect with the new shareable
URL format. The ?paid=1 query is informational — r.js shows a
one-time toast and strips the param via history.replaceState.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4.2: Coupon redirects to `/r/<code>`

**Files:**
- Modify: `js/checkout.js`

`/api/redeem-coupon` already returns `recovery_code` in its response (Task 1.4). Change `setupCoupon`'s submit handler to redirect on success.

- [ ] **Step 1: Replace the success branch**

In `setupCoupon`'s `submit` async function, find the success block (where it calls `onPaid(data)`). Replace with:

```js
if (data.recovery_code) {
  window.location.href = "/r/" + encodeURIComponent(data.recovery_code) + "?paid=1";
  return;
}
// Fallback (shouldn't happen post-Task-1.4): use the old onPaid flow
if (polarHandle && typeof polarHandle.close === "function") {
  try { polarHandle.close(); } catch {}
}
const dialog = document.getElementById("checkout-dialog");
if (dialog && dialog.open) dialog.close();
onPaid(data);
```

- [ ] **Step 2: Verify**

Drop a contract → enter `FREE` → Apply. Expected: full-page navigation to `/r/<code>?paid=1`, dashboard renders, paid-toast shows briefly, work begins.

- [ ] **Step 3: Commit**

```
git add js/checkout.js
git commit -m "Coupon redemption redirects to /r/<code>?paid=1

Mirrors the Polar success_url behavior so all paid paths land on the
new dashboard. Old /?paid=1&session_id= flow no longer exercised by
new payments (existing bookmarks still work via the legacy recovery
URL).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4.3: Push Phase 4

- [ ] **Step 1: Push**

```
git push origin main
```

- [ ] **Step 2: End-to-end verification**

After deploy:
1. Drop a contract → redeem FREE → land on `/r/<code>?paid=1`. Toast shows. Loader plays. Report renders when ready.
2. Bookmark the `/r/<code>` URL. Close the tab. Re-open the bookmark. Expected: dashboard loads with the report still there, no re-payment needed.

---

## Phase 5 — Visual overlay

Phase 5 is the biggest phase. Each task is independently verifiable.

### Task 5.1: Reference asset generator

**Files:**
- Create: `scripts/build-blank.mjs`
- Create: `package.json` script

- [ ] **Step 1: Install pdfjs-dist as a dev dep**

```
npm install --save-dev pdfjs-dist canvas
```

`pdfjs-dist` is the Mozilla renderer; `canvas` is the Node-side canvas implementation it needs.

- [ ] **Step 2: Write the script**

```js
// scripts/build-blank.mjs
//
// Usage:
//   node scripts/build-blank.mjs <input.pdf> <form_id>
//
// Produces:
//   assets/trec-blanks/<form_id>/page-N.png   (one per page, 1200px wide)
//   assets/trec-blanks/<form_id>/manifest.json

import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";
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
  const outDir = resolve(__dirname, "..", "assets", "trec-blanks", formId);
  await fs.mkdir(outDir, { recursive: true });

  let pageHeight = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport, canvasFactory: undefined }).promise;
    const png = canvas.toBuffer("image/png");
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
```

- [ ] **Step 3: Add npm script**

In `package.json` `scripts`:

```json
"build:blanks": "node scripts/build-blank.mjs"
```

- [ ] **Step 4: Run on the existing 20-18 reference**

We have `form-prompts/trec_20-18_ref.pdf`. Run:

```
npm run build:blanks form-prompts/trec_20-18_ref.pdf 20-18
```

Expected: console output listing each page's dimensions, files created at `assets/trec-blanks/20-18/page-1.png` … plus `manifest.json`.

- [ ] **Step 5: Commit assets**

```
git add scripts/build-blank.mjs package.json package-lock.json
git add assets/trec-blanks/20-18/
git commit -m "Add build-blank.mjs and 20-18 reference PNGs

Pre-renders the blank TREC form to PNGs at 1200px wide. The overlay
viewer uses these as the bottom layer for the pixel comparison. The
script is a one-time-per-form developer tool, not in CI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If the PNGs are large (>1MB total), check whether `.DS_Store` or other unwanted files are also staged before committing. Each page should be ~50-200KB for a typical TREC form.

---

### Task 5.2: Overlay viewer module — minimal version

**Files:**
- Create: `js/r-overlay.js`
- Modify: `js/r.js`

Minimal viewer: renders one page (page 1), with the slider, no thumbnails or page nav yet. Phases 5.3 and later add the rest.

- [ ] **Step 1: Write `js/r-overlay.js`**

```js
// js/r-overlay.js — pixel-overlay viewer, lazy-imported by r.js when the
// Overlay tab is first clicked.
//
// Renders the user PDF in-browser via pdfjs-dist (loaded from CDN).
// Reference PNGs are pre-baked at /assets/trec-blanks/<form_id>/.

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";

export async function mount(container, ctx) {
  // ctx: { jobId, downloadToken, formId }
  if (ctx.formId !== "20-18") {
    container.innerHTML = `<div class="overlay-unsupported">Visual overlay coming soon for this form.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="overlay-viewer" id="overlay-viewer">
      <div class="overlay-loading">Loading overlay viewer…</div>
      <div class="overlay-stage" hidden>
        <div class="overlay-labels">
          <div class="overlay-label overlay-label-user">Your Contract</div>
          <div class="overlay-label overlay-label-blank">Blank Original</div>
        </div>
        <div class="overlay-stack" id="overlay-stack">
          <img class="overlay-img-blank" id="overlay-blank" alt="" />
          <img class="overlay-img-user"  id="overlay-user"  alt="" />
        </div>
        <div class="overlay-slider-row">
          <label class="overlay-slider-hint">Drag to compare · press F to flip</label>
          <input type="range" min="0" max="100" value="100" id="overlay-slider" />
        </div>
      </div>
    </div>
  `;

  try {
    const [pdfjs, manifest, userPdfBuf] = await Promise.all([
      import(/* @vite-ignore */ PDFJS_URL),
      fetch("/assets/trec-blanks/20-18/manifest.json").then((r) => r.json()),
      fetch(
        "/api/report?id=" + encodeURIComponent(ctx.jobId) +
        "&token=" + encodeURIComponent(ctx.downloadToken) +
        "&format=pdf"
      ).then((r) => {
        if (!r.ok) throw new Error("Couldn't fetch your contract PDF");
        return r.arrayBuffer();
      }),
    ]);

    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const pdf = await pdfjs.getDocument({ data: userPdfBuf }).promise;
    const userImg = document.getElementById("overlay-user");
    const blankImg = document.getElementById("overlay-blank");
    const stack = document.getElementById("overlay-stack");

    // Set stack dimensions from the manifest (reference is the source of truth)
    stack.style.width = manifest.width + "px";
    stack.style.aspectRatio = `${manifest.width} / ${manifest.height}`;

    // Render page 1 of user PDF at the same width as the reference
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = manifest.width / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    userImg.src = canvas.toDataURL("image/png");
    blankImg.src = "/assets/trec-blanks/20-18/page-1.png";

    document.querySelector(".overlay-loading").remove();
    document.querySelector(".overlay-stage").hidden = false;

    // Slider wires --mix on the viewer container
    const slider = document.getElementById("overlay-slider");
    const viewer = document.getElementById("overlay-viewer");
    const onSlide = () => {
      viewer.style.setProperty("--mix", String(slider.value / 100));
    };
    slider.addEventListener("input", onSlide);
    onSlide();

    // F key flips
    let flipped = false;
    document.addEventListener("keydown", (e) => {
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        flipped = !flipped;
        slider.value = flipped ? 0 : 100;
        onSlide();
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div class="overlay-error">
        Couldn't load the overlay tool. ${escapeHtml(err.message || "Unknown error.")}
        <button class="btn primary" onclick="window.location.reload()">Refresh</button>
      </div>
    `;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Wire `loadOverlayTab` in `r.js`**

Replace the placeholder `loadOverlayTab` body with:

```js
async function loadOverlayTab() {
  if (state.overlayLoaded) return;
  state.overlayLoaded = true;
  const target = $("r-overlay-content");
  if (!state.paid || !state.downloadToken) {
    target.innerHTML = `<p class="rich-foot-note">Pay to unlock the visual overlay.</p>`;
    return;
  }
  try {
    const mod = await import("/js/r-overlay.js");
    await mod.mount(target, {
      jobId: state.jobId,
      downloadToken: state.downloadToken,
      formId: state.data?.stage1?.result?.form_id || null,
    });
  } catch (err) {
    target.innerHTML =
      `<p class="rich-foot-note error">Couldn't load overlay viewer: ${err.message}</p>`;
  }
}
```

Note: `state.paid` isn't tracked yet in `r.js` — set it from `state.data.paid` when the data loads. Add this assignment in `init()` after `state.data = data;`:

```js
state.paid = !!data.paid;
```

- [ ] **Step 3: Add base CSS for the viewer**

Append to `styles.css`:

```css
.overlay-viewer {
  --mix: 1; /* 0 = only blank, 1 = only user */
  margin: 0 auto;
  max-width: 1200px;
}
.overlay-loading, .overlay-error, .overlay-unsupported {
  text-align: center;
  padding: 80px 20px;
  color: var(--muted);
}
.overlay-error { color: #B33B1F; }
.overlay-stage[hidden] { display: none; }
.overlay-labels {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.overlay-label-user  { opacity: var(--mix); transition: opacity 200ms ease; }
.overlay-label-blank { opacity: calc(1 - var(--mix)); transition: opacity 200ms ease; }
.overlay-stack {
  position: relative;
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 1px 8px rgba(0,0,0,0.08);
}
.overlay-stack img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: auto;
  user-select: none;
  -webkit-user-drag: none;
}
.overlay-stack img.overlay-img-blank { /* base layer */ }
.overlay-stack img.overlay-img-user {
  opacity: var(--mix);
  transform: translate(var(--off-x, 0px), var(--off-y, 0px))
             scale(var(--scale, 1));
  transform-origin: top left;
  transition: opacity 200ms ease;
}
.overlay-slider-row {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.overlay-slider-row input[type="range"] {
  width: 100%;
  max-width: 600px;
}
.overlay-slider-hint {
  font-size: 12.5px;
  color: var(--muted);
}
```

- [ ] **Step 4: Verify**

Visit `/r/<code>` for a paid 20-18 contract. Click Overlay tab. Expected:
- Brief "Loading overlay viewer…" message
- Page 1 appears with user contract overlaid on blank
- Drag the slider — user image fades to reveal blank
- Press F — instant flip

- [ ] **Step 5: Commit**

```
git add js/r-overlay.js js/r.js styles.css
git commit -m "Add overlay viewer (page 1, slider, F-key flip)

Lazy-loads pdfjs-dist from CDN, fetches the user PDF and the
pre-baked reference PNG, stacks them in the DOM with an opacity
slider that wires --mix CSS var. Labels in the corners fade with
their image layer. Page navigation, thumbs, and alignment nudge
come in follow-up tasks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.3: Page navigation + thumbnails

**Files:**
- Modify: `js/r-overlay.js`
- Modify: `styles.css`

Add Prev/Next + thumbnail strip. Render thumbnails by re-using the same canvas data URLs at smaller display sizes.

- [ ] **Step 1: Refactor `mount` to render-on-demand**

Restructure `mount` so page rendering is a function `renderPage(n)` that updates the user image src. The viewer keeps a cache of rendered page data URLs.

```js
const pageCache = new Map(); // n -> data URL
const totalPages = pdf.numPages;
let currentPage = 1;

async function renderPage(n) {
  if (pageCache.has(n)) {
    userImg.src = pageCache.get(n);
    blankImg.src = `/assets/trec-blanks/20-18/page-${n}.png`;
    currentPage = n;
    updatePageIndicator();
    updateActiveThumb();
    return;
  }
  const page = await pdf.getPage(n);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = manifest.width / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  pageCache.set(n, dataUrl);
  userImg.src = dataUrl;
  blankImg.src = `/assets/trec-blanks/20-18/page-${n}.png`;
  currentPage = n;
  updatePageIndicator();
  updateActiveThumb();
}
```

- [ ] **Step 2: Add navigation DOM**

Inside `mount`, after the existing `.overlay-stage` block, add:

```js
container.querySelector(".overlay-stage").insertAdjacentHTML("beforeend", `
  <div class="overlay-nav">
    <button class="overlay-nav-btn" id="overlay-prev">‹ Prev</button>
    <span class="overlay-nav-page" id="overlay-page-indicator">Page 1 of ${totalPages}</span>
    <button class="overlay-nav-btn" id="overlay-next">Next ›</button>
  </div>
  <div class="overlay-thumbs" id="overlay-thumbs"></div>
`);
```

- [ ] **Step 3: Build thumbnails**

After the first page renders, kick off thumbnail generation in the background:

```js
async function buildThumbs() {
  const thumbs = document.getElementById("overlay-thumbs");
  for (let n = 1; n <= totalPages; n++) {
    const btn = document.createElement("button");
    btn.className = "overlay-thumb" + (n === 1 ? " is-active" : "");
    btn.dataset.page = String(n);
    btn.title = "Page " + n;
    btn.innerHTML = `<img src="/assets/trec-blanks/20-18/page-${n}.png" alt="" /><span>${n}</span>`;
    btn.onclick = () => renderPage(n);
    thumbs.appendChild(btn);
  }
}
```

The reference PNG is shown in the thumb (the user PDF rendering is still cached as full-size; thumbnails reuse the *blank* reference because they're identical aspect-ratio and we already have them; if you want user-content thumbnails, swap `btn.innerHTML`'s `src` to the cached data URL once `renderPage(n)` has run).

For v1, blank-reference thumbnails are simpler and look the same shape.

- [ ] **Step 4: Wire up Prev/Next + arrow keys**

```js
document.getElementById("overlay-prev").onclick = () => {
  if (currentPage > 1) renderPage(currentPage - 1);
};
document.getElementById("overlay-next").onclick = () => {
  if (currentPage < totalPages) renderPage(currentPage + 1);
};
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" && currentPage > 1) {
    e.preventDefault();
    renderPage(currentPage - 1);
  } else if (e.key === "ArrowRight" && currentPage < totalPages) {
    e.preventDefault();
    renderPage(currentPage + 1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    // Switch back to Full Report tab — emit a custom event r.js listens for
    container.dispatchEvent(new CustomEvent("overlay:exit", { bubbles: true }));
  }
});

function updatePageIndicator() {
  const ind = document.getElementById("overlay-page-indicator");
  if (ind) ind.textContent = `Page ${currentPage} of ${totalPages}`;
}
function updateActiveThumb() {
  document.querySelectorAll(".overlay-thumb").forEach((b) =>
    b.classList.toggle("is-active", Number(b.dataset.page) === currentPage),
  );
  const active = document.querySelector(".overlay-thumb.is-active");
  if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}
```

In `r.js`, listen for the exit event:

```js
document.addEventListener("overlay:exit", () => activateTab("report"));
```

- [ ] **Step 5: Add CSS**

```css
.overlay-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 600px;
  margin: 12px auto 0;
}
.overlay-nav-btn {
  background: none;
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--slate);
}
.overlay-nav-btn:hover { border-color: #C9D2E0; }
.overlay-nav-page { font-size: 13px; color: var(--muted); }

.overlay-thumbs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 12px 4px;
  margin-top: 12px;
}
.overlay-thumb {
  flex: 0 0 auto;
  width: 80px;
  background: none;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  position: relative;
}
.overlay-thumb img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #fff;
}
.overlay-thumb span {
  position: absolute;
  top: 4px; left: 4px;
  background: rgba(0,0,0,0.5);
  color: #fff;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
}
.overlay-thumb.is-active { border-color: var(--blue); }
```

- [ ] **Step 6: Verify**

Visit overlay tab. Expected:
- Page indicator says "Page 1 of N"
- Prev/Next buttons work
- Arrow keys navigate
- Esc returns to Full Report tab
- Thumbnail strip below; clicking thumbs jumps pages
- Active thumb has blue border

- [ ] **Step 7: Commit**

```
git add js/r-overlay.js js/r.js styles.css
git commit -m "Overlay: page nav + thumbnails strip + keyboard

Prev/Next, arrow keys, Esc to exit, page indicator, scrollable
thumbnail strip with active highlight. Pages render lazily on
demand and cache as data URLs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.4: Manual alignment nudge

**Files:**
- Modify: `js/r-overlay.js`
- Modify: `styles.css`

- [ ] **Step 1: Add nudge UI**

Inside `mount`, after the navigation block, append:

```js
container.querySelector(".overlay-stage").insertAdjacentHTML("beforeend", `
  <details class="overlay-align">
    <summary>Adjust alignment</summary>
    <div class="overlay-align-controls">
      <label>X offset
        <input type="range" min="-20" max="20" step="1" value="0" id="ov-off-x" />
      </label>
      <label>Y offset
        <input type="range" min="-20" max="20" step="1" value="0" id="ov-off-y" />
      </label>
      <label>Scale
        <input type="range" min="0.95" max="1.05" step="0.001" value="1" id="ov-scale" />
      </label>
      <button class="overlay-nav-btn" id="ov-reset">Reset</button>
    </div>
  </details>
`);
```

- [ ] **Step 2: Wire to CSS variables + localStorage**

```js
const ALIGN_KEY = "trex-align:" + ctx.jobId;
function loadAlignment() {
  try {
    return JSON.parse(localStorage.getItem(ALIGN_KEY) || "{}");
  } catch { return {}; }
}
function saveAlignment(a) {
  try { localStorage.setItem(ALIGN_KEY, JSON.stringify(a)); } catch {}
}
function applyAlignment(a) {
  const viewer = document.getElementById("overlay-viewer");
  viewer.style.setProperty("--off-x", (a.x ?? 0) + "px");
  viewer.style.setProperty("--off-y", (a.y ?? 0) + "px");
  viewer.style.setProperty("--scale", String(a.scale ?? 1));
}

const align = loadAlignment();
document.getElementById("ov-off-x").value = String(align.x ?? 0);
document.getElementById("ov-off-y").value = String(align.y ?? 0);
document.getElementById("ov-scale").value = String(align.scale ?? 1);
applyAlignment(align);

const onAlignChange = () => {
  const a = {
    x: Number(document.getElementById("ov-off-x").value),
    y: Number(document.getElementById("ov-off-y").value),
    scale: Number(document.getElementById("ov-scale").value),
  };
  applyAlignment(a);
  saveAlignment(a);
};
["ov-off-x", "ov-off-y", "ov-scale"].forEach((id) => {
  document.getElementById(id).addEventListener("input", onAlignChange);
});
document.getElementById("ov-reset").onclick = () => {
  document.getElementById("ov-off-x").value = "0";
  document.getElementById("ov-off-y").value = "0";
  document.getElementById("ov-scale").value = "1";
  onAlignChange();
};
```

- [ ] **Step 3: Add CSS**

```css
.overlay-align {
  margin-top: 16px;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}
.overlay-align summary {
  cursor: pointer;
  font-size: 12.5px;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.overlay-align[open] summary { color: var(--slate); }
.overlay-align-controls {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 12px;
  margin-top: 12px;
  align-items: end;
}
.overlay-align-controls label {
  display: flex;
  flex-direction: column;
  font-size: 11.5px;
  color: var(--muted);
  gap: 4px;
}
@media (max-width: 600px) {
  .overlay-align-controls { grid-template-columns: 1fr 1fr; }
}
```

- [ ] **Step 4: Verify**

- Open overlay → click "Adjust alignment". Three sliders + Reset appear.
- Move X — user image shifts horizontally, persists across page nav.
- Reload page — adjustments persist (localStorage).
- Reset — back to zero.

- [ ] **Step 5: Commit**

```
git add js/r-overlay.js styles.css
git commit -m "Overlay: manual X/Y/scale alignment nudge with localStorage

Three sliders to compensate for misalignment when the user PDF doesn't
exactly match the standard form (scanned, slightly different DPI, etc.).
Adjustments save per-job to localStorage so they persist across visits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.5: Push Phase 5 + final smoke test

- [ ] **Step 1: Final typecheck**

```
npx tsc --noEmit
```

- [ ] **Step 2: Push**

```
git push origin main
```

- [ ] **Step 3: Production verification**

After deploy:
1. Drop a 20-18 contract on `/`.
2. Pre-warm fires; Pay opens instantly (Phase 3).
3. Use FREE coupon; redirect to `/r/<code>?paid=1` (Phase 4).
4. Loader plays (render.js controller, Phase 1).
5. Report renders; switch tabs.
6. Click Overlay; pdfjs loads from CDN; page 1 appears overlaid.
7. Slider works; F flips; arrows navigate; Esc exits.
8. Adjust alignment if needed.
9. Bookmark URL, close tab, reopen — everything persists (localStorage + URL is login).

If a 20-18 isn't available, drop a different form: Overlay tab is disabled with the tooltip.

---

## Self-review checklist

Before considering this plan complete:

1. **Spec coverage:** Does every section of the spec map to a task? — Yes (Phase 1: routing+data, Phase 2: page+tabs, Phase 3: pre-warming, Phase 4: redirects, Phase 5: overlay).
2. **Placeholder scan:** Any TBD/TODO/vague? — None remain.
3. **Type consistency:** `recovery_code` (snake_case in API), `recoveryCode` (camelCase in TS), `recovery_code` (snake_case in SQL). All references use the right form.
4. **Ambiguity:** All function signatures and CSS variable names are spelled out.

## Out of scope for this plan

- Multi-form overlay support (architecture is ready; just drop new PNGs in `assets/trec-blanks/<form_id>/`).
- Auto-alignment for scanned PDFs.
- Diff highlighting (e.g. mark added words in red). Could be a future task.
- Email-this-URL-to-me feature.
- Replacing the existing `/?job=&token=` recovery flow. Old URLs keep working forever.
