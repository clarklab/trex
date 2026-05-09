# Standalone Report Page with Visual Overlay

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-08

## Goal

Replace the current `/?job=X&token=Y` recovery URL with a standalone, shareable, persistent dashboard at `/r/<short-code>` that becomes the buyer's "login" for their paid report — no accounts, no storage of personal info beyond what the report contains. Add a pixel-overlay viewer to that dashboard that lets buyers compare their TREC contract against the standard blank form to catch line-item edits. Pre-warm Polar checkouts after quick-scan completes so the Pay button feels instant.

## Non-goals

- Not building a real account system. The URL is the only credential.
- Not auto-aligning scanned PDFs (manual nudge UI handles that).
- Not supporting all 8 TREC forms in v1 — overlay is 20-18 only. Architecture supports adding more by dropping in PNG assets.
- Not changing how PDFs flow on the server side. The user contract is still stored in `uploads` blob storage; reports stay in `reports`. We add no new server-side image storage.
- Not migrating existing recovery URLs. Pre-spec sessions keep working at the old URL forever; new sessions use `/r/<code>`.

## Architecture

### Routing

| Route | Handler | Purpose |
|---|---|---|
| `GET /r/:code` | static `r.html` (via netlify.toml redirect, status 200) | Serves the dashboard shell |
| `GET /api/r/:code` | new `netlify/functions/r-resolve.mts` | Resolves code → `{job_id, download_token, tier, paid, status, ...}` |
| `GET /api/report?id=X&token=Y` | unchanged | Existing report-data endpoint; dashboard hits it after resolving |
| `GET /api/report?...&format=pdf` | unchanged | Used by overlay tab to fetch user PDF for in-browser rasterization |

`r.html` is a single static page. `js/r.js` reads `window.location.pathname` to extract the code, calls `/api/r/:code`, then drives the rest of the UI from the response.

### Data model

One new column on `checkout_sessions`:

```sql
ALTER TABLE checkout_sessions
  ADD COLUMN recovery_code text UNIQUE;
CREATE UNIQUE INDEX checkout_sessions_recovery_code_idx
  ON checkout_sessions (recovery_code);
```

Generated server-side in `/api/checkout-init` and `/api/redeem-coupon` before the row is inserted:

```ts
import { randomBytes } from "node:crypto";
const recoveryCode = randomBytes(9).toString("base64url"); // 12 chars, ~72 bits
```

Collision check is implicit via the unique index — a duplicate insert would throw, which we log and retry once with a fresh code.

### Polar success URL

Baked at checkout creation:

```ts
const successUrl = `${origin}/r/${recoveryCode}?paid=1`;
```

After payment, Polar drops the buyer directly on the dashboard. The `?paid=1` query is informational — `r.js` shows a one-time "payment confirmed" toast on first visit, then strips it from the URL via `history.replaceState`.

### Coupon flow

`/api/redeem-coupon` returns `{ recovery_code, ... }` in its response. The frontend, on success, redirects via `window.location = "/r/" + recovery_code` — so the user lands on the dashboard with no manual flow change needed.

## Page layout

```
┌──────────────────────────────────────────────────────────────┐
│  T-REX LAWYER                                  [rex logo]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ⚠️  This URL is your login. Anyone with it can see this    │
│      report. We don't store personal info beyond the         │
│      contract data.                                          │
│                                                              │
│  ┌────────────────────────────────────────────┐              │
│  │ trexlawyer.com/r/h7F2pXq9LkN4   [📋 Copy]  │              │
│  └────────────────────────────────────────────┘              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [📄 Full Report] [🔍 Visual Overlay] [💬 Chat]              │
│                                                              │
│  ┌──────── ACTIVE TAB CONTENT ────────────────┐             │
│  │ (report rendering, overlay viewer, chat)   │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  Tier: Single review · Paid May 8, 2026                      │
│  Form: TREC 20-18 · 11 pages · 3 modifications flagged       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

White background throughout. Concerned-rex banner only appears on errors; cheering-rex appears when work completes.

### Tabs

| Tab | Content | Notes |
|---|---|---|
| **Full Report** (default) | Existing post-payment report rendering, including download buttons (1 PDF for single, 3 for panel). For panel tier, the existing 3-tab Claude/GPT/Gemini selector renders inside this tab. | Largely a port of what's currently inside `app.js`'s `loadFullReport()` and `loadPanelReport()`. |
| **Visual Overlay** | Pixel-overlay viewer (see below). Lazy-loads `pdfjs-dist` from CDN on first click. | Disabled with tooltip when `form_id !== "20-18"`. |
| **Chat** | Port of the existing T-REX chat widget, scoped to this job's `job_id`. | Backend `chat-stream` already takes `job_id`; no changes needed. |

### Loading + error states

The post-payment loader we shipped earlier (rotating rex poses, fading status messages, opacity slider, concerned-rex error mode) moves into `js/render.js` and is rendered **inside the active tab content area** while work is incomplete. When work finishes, the loader fades out and the tab content fades in.

**Per-tab readiness:** the Full Report tab depends on stage2 (or panel results) — loader stays until those land. The **Overlay tab** only depends on the user PDF, which is available the moment payment confirms. So Overlay becomes usable as soon as the page resolves, even while the AI is still drafting the report. The **Chat tab** has its own internal loading state from the existing widget. Switching tabs while work is loading is fine — each tab independently decides whether to show its loader.

## Visual overlay design

### Reference assets (committed once)

- `assets/trec-blanks/20-18/page-1.png` … `page-N.png`, 1200px wide, ~150 DPI equivalent. Background-only blank reference, all form fields empty.
- `assets/trec-blanks/20-18/manifest.json`:
  ```json
  { "page_count": 11, "width": 1200, "height": 1553 }
  ```
- `scripts/build-blank.mjs` — local-only script that takes a PDF and emits the page PNGs + manifest. Run by the developer when adding a new form. Not in CI.

### Library

[`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) version 4.x, loaded **dynamically** only when the Overlay tab is opened:

```js
const pdfjs = await import(
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs"
);
```

Zero cost for users who never open the tab. ~600KB gzipped on first open, cached by the browser thereafter.

### Render flow (when user clicks Overlay tab)

1. Fetch the user PDF: `GET /api/report?id=<jobId>&token=<token>&format=pdf` → ArrayBuffer.
2. `pdfjs.getDocument(buffer).promise` → `pdf` document.
3. For each page (lazy — render the visible page first, others on demand):
   - `pdf.getPage(n)` → page
   - Compute viewport scale so the rendered width matches the reference manifest width (1200px).
   - Render to an offscreen `<canvas>` at that scale.
   - `canvas.toDataURL("image/png")` → cache in memory keyed by page number.
4. Build the viewer DOM with both image stacks (user above, reference below) at identical dimensions.

Page renders are cached in memory only — never persisted. When the user navigates away from the Overlay tab, in-memory state is preserved (so re-entering is instant). When they leave the page entirely, everything is GC'd.

### Slider UI

```
┌───────────────────── overlay viewer ─────────────────────────────┐
│ ┌─Your Contract──────┐               ┌─────Blank Original──────┐ │
│ │ (label fades       │               │ (label fades           │ │
│ │  with image)       │               │  with image)           │ │
│ └────────────────────┘               └─────────────────────────┘ │
│                                                                  │
│         [stacked images: blank below, user above]                │
│                                                                  │
│   [── ⚪ ────────────────] ← drag this; tap F to flip            │
│                                                                  │
│ < Prev   ●○○○○○○○○○○   Page 1 of 11   Next >                    │
│                                                                  │
│ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb]  │
│                                                                  │
│ Adjust alignment ↓                                               │
└──────────────────────────────────────────────────────────────────┘
```

#### CSS structure

```css
.overlay-viewer {
  --mix: 1;     /* 0 = only blank, 1 = only user */
}
.overlay-stack {
  position: relative;
  width: 1200px; /* from manifest */
}
.overlay-stack img {
  position: absolute; inset: 0; width: 100%;
}
.overlay-img-blank { /* bottom layer, always visible */ }
.overlay-img-user  {
  /* top layer, opacity follows the slider */
  opacity: var(--mix);
  transform: translate(var(--off-x, 0px), var(--off-y, 0px))
             scale(var(--scale, 1));
  transform-origin: top left;
  transition: opacity 200ms ease;
}
.overlay-label-user  { opacity: var(--mix); transition: opacity 200ms ease; }
.overlay-label-blank { opacity: calc(1 - var(--mix)); transition: opacity 200ms ease; }
```

#### Slider interaction

- Native `<input type="range" min="0" max="100" value="100">` — JS sets `--mix = value / 100` on the container.
- **F key** toggles `--mix` between 0 and 1 (with the 200ms transition for the eye to register the flip).
- **Arrow keys** navigate pages.
- **Esc** switches back to the Full Report tab.

### Alignment nudge UI (collapsed by default)

Three sliders below "Adjust alignment ↓":
- **X offset** — `range`, -20 to +20 px
- **Y offset** — `range`, -20 to +20 px
- **Scale** — `range`, 0.95 to 1.05

Apply via `--off-x`, `--off-y`, `--scale` CSS variables on the user image only. Adjustments persist via `localStorage.setItem("trex-align:" + jobId, JSON.stringify({x, y, scale}))` so the user only nudges once per contract.

### Thumbnails

- Bottom strip, horizontally scrollable on mobile.
- Each thumbnail is 80px wide, generated from the same in-memory page data URLs (smaller render scale).
- Active page gets a `outline: 2px solid var(--blue)`.
- If `stage2.modifications` includes `page_number` references (best-effort — the LLM doesn't always include them), thumbnails for pages with modifications get a small red dot. If page numbers aren't available, all thumbnails look the same.

### Performance

- Render only the visible page eagerly; queue others as the user navigates.
- Cap concurrent renders at 2.
- Thumbnails reuse the page data URL at a smaller `<img>` size — single render per page, two display sizes.
- Web Worker is not necessary at this scale; pdfjs-dist already does its heavy work off the main thread.

### Failure modes

| Failure | UI |
|---|---|
| pdfjs-dist CDN fails to load | "Couldn't load the overlay tool. Try refreshing." with a refresh button. Other tabs still work. |
| User PDF fails to render a page | Show that page's thumbnail greyed out, with "Page failed to render" inside the viewer when navigated to. |
| `form_id !== "20-18"` | Tab is `[disabled]` with tooltip: "Overlay coming soon for this form." Tab can't be clicked. |

## Polar pre-warming

### Flow

1. Quick scan completes → frontend's existing polling detects `stage1Status === "complete"` and renders the rich preview.
2. **At that moment**, frontend fires two parallel `POST /api/checkout-init` requests, one for `tier=single` and one for `tier=panel`. The job_id is already known.
3. Each response includes `{ session_id, polar_checkout_url, recovery_code }`. Frontend caches both in module state:
   ```js
   const prewarmedCheckouts = { single: {...}, panel: {...} };
   ```
4. When the user clicks Unlock for either tier, `openCheckout()` checks the cache first. If a pre-warmed checkout exists for that tier, it skips `/api/checkout-init` entirely and passes the cached URL straight to `Polar.EmbedCheckout.create()`. **The overlay opens instantly.**

### Cache invalidation

- After first use of a pre-warmed checkout (since each Polar checkout can only be used once).
- After 30 minutes (Polar checkouts expire eventually).
- If `openCheckout()` is called with a tier we don't have cached, fall through to live `/api/checkout-init` exactly like today. Pre-warming is purely an optimization.

### Cost

Polar bills on conversion only — unused checkouts cost nothing. Two extra API calls per drop is acceptable.

### Side effect: orphan sessions

Each pre-warmed call creates a `checkout_sessions` row. When the user pays for one tier, the other tier's session sits with `status=pending` indefinitely (matches today's behavior for any abandoned checkout — no new cleanup work needed). The unused row's `recovery_code` is still unique and resolvable, but it points to an unpaid session, so `/api/r/:code` returns `paid=false` and the dashboard shows the unlock CTAs again — same as if you visited that URL fresh. No leak, no privacy concern.

## Refactor scope

One small extraction is needed before adding the dashboard:

**`js/render.js` (new):**
- `renderFullReport(stage2Result, options)`
- `renderPanelReport(panelData, options)`
- `showGeneratingLoader(tier)` / `hideGeneratingLoader()` / `showLoaderError(...)`
- `friendlyDeepError(rawError)`
- `escapeHtml(s)` / `escapeAttr(s)`
- The loader timer/state is module-private state.

**`js/app.js` and `js/r.js`** both import from `js/render.js`. ~30 minutes of mechanical extraction. No behavior change for the upload page.

## Migration / rollout

1. Add column + unique index via migration `<ts>_recovery_codes`.
2. Deploy. Existing flows continue to work — `recovery_code` is `NULL` for pre-deploy sessions, but those use the old `/?job=&token=` URLs.
3. New checkouts (Polar + coupon) generate `recovery_code` on creation; redirects target `/r/<code>`.
4. The dashboard page is gated by URL presence — no feature flag needed. Rolling forward is the deployment.
5. Pre-existing bookmarks at `/?job=&token=` keep working forever (`/api/report` unchanged).

## Open implementation questions for the plan

These are deferred to writing-plans:

- File-by-file edit order for the `render.js` extraction without breaking the upload page mid-edit.
- Exact pdfjs-dist CDN URL (4.x has multiple build flavors; pick the ESM one).
- How to source the blank 20-18 PDF — TREC publishes them at stable URLs (`https://www.trec.texas.gov/sites/default/files/pdf-forms/20-18.pdf`); decide whether to commit the raw PDF or only the rendered PNGs.
- Whether the chat tab needs any UI changes vs. just dropping the existing widget into a tab pane.
