# TREC Contract Scanner: Homepage Build PRD

> **Implementation note (post-swap):** the card payment rail is now Polar (merchant of record) using `@polar-sh/checkout` embedded overlay rather than Stripe Payment Element. Map historical `Stripe`/`stripe-webhook`/`stripe_intent_id`/`STRIPE_*` references to `Polar`/`polar-webhook`/`polar_checkout_id`/`POLAR_*`. The rest of the architecture (LN side, fan-out, polling, signed download tokens, DB tables) is unchanged.

This document is the complete specification for building the TREC Contract Scanner homepage. It covers every function, endpoint, database table, and frontend behavior the implementing agent needs to produce. It intentionally contains zero design or styling direction -- a separate agent will handle all visual design. Everything here must work.

## 1. What this page does

A single-page app where a user drags a TREC contract PDF (up to 10 MB) onto a drop zone, gets a free AI-generated summary within ~30 seconds, and can pay $5 to unlock a full detailed report. Payment is accepted via Polar (USD card, merchant of record) or Lightning Network (Bitcoin). AI analysis happens in two stages: a fast model returns a quick preview, then a deep model produces the full report in the background.

## 2. High-level architecture

```
Browser (vanilla HTML/JS)
  |
  +--POST /api/upload -----------> [Netlify Function: upload.mts]
  |                                  - Validates PDF (type, size <= 10MB)
  |                                  - Stores PDF in Netlify Blobs (store: "uploads")
  |                                  - Inserts job row into Netlify Database
  |                                  - Calls Stage 1 (quick-scan) function internally via fetch
  |                                  - Returns { job_id }
  |
  +--GET /api/job-status?id=X ---> [Netlify Function: job-status.mts]
  |                                  - Reads job row from DB
  |                                  - Returns current stage, status, and available results
  |
  +--POST /api/checkout-init ----> [Netlify Function: checkout-init.mts]
  |                                  - Creates Stripe PaymentIntent ($5)
  |                                  - Fetches Lightning invoice (~$5 in sats)
  |                                  - Creates checkout session row in DB
  |                                  - Returns { session_id, stripe_client_secret, ln_invoice, ln_amount_sats }
  |
  +--GET /api/checkout-status ---> [Netlify Function: checkout-status.mts]
  |                                  - Polls DB + LN verify URL
  |                                  - Returns { status: "pending" | "paid", download_token? }
  |
  +--POST /api/stripe-webhook ---> [Netlify Function: stripe-webhook.mts]
  |                                  - Verifies Stripe signature
  |                                  - Flips checkout session to "paid" in DB
  |
  +--GET /api/report?id=X -------> [Netlify Function: report.mts]
  |                                  - Returns free-tier results always
  |                                  - Returns paid-tier results only with valid download token
  |
  +-- (internal, not client-facing):
      POST /.netlify/functions/quick-scan-background
        - Stage 1: fast model reads PDF, writes free preview to DB
      POST /.netlify/functions/deep-scan-background
        - Stage 2: deep model reads PDF, writes full report to DB
```

## 3. Tech stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Hosting | Netlify | Static site + functions |
| Frontend | Vanilla HTML + JS | Single `index.html` + JS modules. No framework. |
| Serverless | Netlify Functions v2 (`.mts`) | All API endpoints |
| Long-running AI | Netlify Background Functions | `-background` suffix, 15-min limit |
| Database | Netlify Database (Postgres via Drizzle ORM) | `@netlify/database` + `drizzle-orm@beta` |
| File storage | Netlify Blobs | Uploaded PDFs and generated PDF reports |
| AI inference | Netlify AI Gateway | Zero-config SDK constructors |
| Card payments | Stripe Payment Element | Inline, no redirect |
| Bitcoin payments | Lightning via Alby LNURL-pay | QR code + polling via LUD-21 verify |
| QR rendering | `qrcode` npm package | For Lightning invoice display |
| PDF parsing | `pdf-parse` npm package | Extract text from uploaded PDFs server-side |

## 4. AI model selection (via Netlify AI Gateway)

All AI calls go through Netlify AI Gateway. Use the official SDK with a zero-config constructor (no API key needed).

### Stage 1: Quick Scan (fast model)

**Model:** `claude-haiku-4-5` (Anthropic) via `@anthropic-ai/sdk`

Purpose: rapid first-pass extraction. Must return in under 30 seconds. Produces:
- TREC form identification + confidence score
- Modification count estimate
- Top 3 red flag titles (no explanations)
- Basic terms extraction (price, option period, closing date, parties, financing type)

### Stage 2: Deep Scan (deep model)

**Model:** `claude-sonnet-4-6` (Anthropic) via `@anthropic-ai/sdk`

Purpose: comprehensive clause-by-clause analysis. May take 1-5 minutes. Produces:
- Every modification shown with standard form comparison
- Plain-English explanation of each change
- Risk rating per change (low / medium / high)
- Suggested questions for the other party / attorney
- Full term-by-term summary

### SDK usage pattern

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic() // zero-config, Netlify injects env vars

const message = await anthropic.messages.create({
  model: 'claude-haiku-4-5',  // or 'claude-sonnet-4-6'
  max_tokens: 4096,
  messages: [{ role: 'user', content: promptText }],
})
```

### Why two stages

PDFs are large (5-10 MB of text content). A single deep scan can take minutes. Users need immediate feedback that their upload worked and the system is reading their contract. Stage 1 gives them useful information in ~15-30 seconds. Stage 2 runs concurrently in the background and the client polls for completion.

### PDF text extraction

Use `pdf-parse` to extract text from the uploaded PDF before sending to AI models. The raw PDF binary cannot be sent directly. Extract all text content and pass it as a string in the AI prompt.

```typescript
import pdfParse from 'pdf-parse'

const pdfBuffer = await store.get(blobKey, { type: 'arrayBuffer' })
const parsed = await pdfParse(Buffer.from(pdfBuffer))
const textContent = parsed.text // full extracted text
```

## 5. Upload flow and the 6 MB payload constraint

Netlify Functions have a 6 MB buffered request payload limit. PDFs can be up to 10 MB. The implementing agent must handle this.

**Required approach: chunked client-side upload**

1. Client reads the dropped file via `FileReader` as an `ArrayBuffer`.
2. Client calls `POST /api/upload-init` with metadata only (filename, size, MIME type). Server creates a job row in DB with status `uploading`, creates a blob key, returns `{ job_id, blob_key, chunk_size }`.
3. Client splits the file into chunks of ~4 MB each and sends each chunk via `POST /api/upload-chunk` with `{ job_id, chunk_index, total_chunks }` and the binary chunk as the request body.
4. Server appends each chunk to a temporary Blob key (`uploads/{job_id}/chunk-{index}`).
5. After all chunks are sent, client calls `POST /api/upload-complete` with `{ job_id }`.
6. Server concatenates all chunks into the final Blob (`uploads/{job_id}/contract.pdf`), deletes chunk blobs, updates job status to `processing`, and triggers the background scan functions.

This avoids hitting the 6 MB payload limit while supporting 10 MB files.

### Endpoints for chunked upload

**`POST /api/upload-init`** -- `netlify/functions/upload-init.mts`
- Request body: `{ filename: string, size: number, mime_type: string }`
- Validates: `mime_type === 'application/pdf'`, `size <= 10_485_760` (10 MB)
- Creates job row in DB (status: `uploading`)
- Returns: `{ job_id: string, chunk_size: 4194304 }` (4 MB chunks)

**`POST /api/upload-chunk`** -- `netlify/functions/upload-chunk.mts`
- Request body: binary chunk data
- Query params: `?job_id=X&chunk_index=N&total_chunks=M`
- Stores chunk in Blobs at key `uploads/{job_id}/chunk-{chunk_index}`
- Returns: `{ received: true }`

**`POST /api/upload-complete`** -- `netlify/functions/upload-complete.mts`
- Request body: `{ job_id: string }`
- Reads all chunk blobs, concatenates into single PDF blob at `uploads/{job_id}/contract.pdf`
- Deletes individual chunk blobs
- Updates job status to `processing` in DB
- Fires off Stage 1 and Stage 2 background functions via internal fetch:
  ```typescript
  // Fire and forget -- these are background functions, they return 202 immediately
  fetch(`${siteUrl}/.netlify/functions/quick-scan-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id }),
  })
  fetch(`${siteUrl}/.netlify/functions/deep-scan-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id }),
  })
  ```
- Returns: `{ job_id, status: 'processing' }`

## 6. Background processing functions

### `quick-scan-background` -- `netlify/functions/quick-scan-background.mts`

This is a **background function** (filename ends in `-background`). Client receives 202 immediately. Function runs up to 15 minutes.

Steps:
1. Parse `job_id` from request body.
2. Read job row from DB. If status is not `processing`, exit.
3. Update job: `stage1_status = 'running'`.
4. Read PDF from Blobs (`uploads/{job_id}/contract.pdf`).
5. Extract text via `pdf-parse`.
6. Send text to `claude-haiku-4-5` with a prompt that requests:
   - TREC form identification (which form number/name, confidence 0-100)
   - Estimated number of modifications vs standard form
   - Top 3 red flag titles (just titles, no explanations)
   - Basic terms: price, option period length, closing date, buyer name, seller name, financing type
7. Parse the structured JSON response.
8. Write results to DB: `stage1_status = 'complete'`, `stage1_result = <JSON>`.
9. If AI call fails, set `stage1_status = 'error'`, `stage1_error = <message>`.

**Prompt structure for Stage 1:**

The prompt must instruct the model to return valid JSON. Include the full PDF text. Request the model identify the specific TREC form, detect deviations from standard language, and extract key terms. Provide the standard TREC form names and numbers in the prompt so the model can match against them.

```
You are analyzing a Texas Real Estate Commission (TREC) contract. Return ONLY valid JSON.

Identify which TREC standard form this contract is based on:
- 20-18: One to Four Family Residential Contract (Resale)
- 23-19: Residential Condominium Contract (Resale)
- 24-19: Farm and Ranch Contract
- 25-13: Unimproved Property Contract
- 30-17: Residential Contract (New Home, Incomplete Construction)
- 9-17: Residential Contract (New Home, Completed Construction)

Return this exact JSON structure:
{
  "form_id": "20-18",
  "form_name": "One to Four Family Residential Contract (Resale)",
  "confidence": 92,
  "modification_count": 7,
  "red_flags": ["Title 1", "Title 2", "Title 3"],
  "terms": {
    "price": "$350,000",
    "option_period_days": 10,
    "closing_date": "2025-03-15",
    "buyer": "Jane Doe",
    "seller": "John Smith",
    "financing_type": "Conventional"
  }
}

Contract text:
---
{PDF_TEXT}
---
```

### `deep-scan-background` -- `netlify/functions/deep-scan-background.mts`

Also a **background function**. Runs up to 15 minutes.

Steps:
1. Parse `job_id` from request body.
2. Read job row from DB. If status is not `processing`, exit.
3. Update job: `stage2_status = 'running'`.
4. Read PDF from Blobs.
5. Extract text via `pdf-parse`.
6. Send text to `claude-sonnet-4-6` with a detailed prompt requesting:
   - Every clause that deviates from the standard TREC form
   - For each deviation: the standard text vs. the contract text, plain-English explanation, risk rating (low/medium/high)
   - Suggested questions to ask the other party or attorney for each deviation
   - Complete term-by-term summary of the entire contract
7. Parse structured JSON response.
8. Write results to DB: `stage2_status = 'complete'`, `stage2_result = <JSON>`.
9. Generate a downloadable PDF report from the results and store it in Blobs at `reports/{job_id}/full-report.pdf`.
10. Update job: `report_blob_key = 'reports/{job_id}/full-report.pdf'`.
11. On failure: `stage2_status = 'error'`, `stage2_error = <message>`.

**Important timeout note:** `claude-sonnet-4-6` with a large contract may take 2-5 minutes to respond. Background functions have a 15-minute limit, so this is safe. The AI SDK call itself may need a custom timeout. Set it via:

```typescript
const anthropic = new Anthropic({ timeout: 600_000 }) // 10 minute timeout
```

**Prompt structure for Stage 2:**

Similar to Stage 1 but far more detailed. Include the full PDF text. Request a comprehensive JSON response with an array of modifications, each containing standard text, contract text, explanation, risk rating, and suggested questions. Also request a full terms summary.

## 7. Database schema

Use Netlify Database with Drizzle ORM. Schema file: `db/schema.ts`. Client file: `db/index.ts`. Config: `drizzle.config.ts`.

### Jobs table

Tracks every uploaded contract through its processing lifecycle.

```typescript
// db/schema.ts
import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core"

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").notNull().default("uploading"),
  // status values: "uploading" | "processing" | "complete" | "error"

  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  blobKey: text("blob_key"),

  // Stage 1 (quick scan)
  stage1Status: text("stage1_status").notNull().default("pending"),
  // stage1_status values: "pending" | "running" | "complete" | "error"
  stage1Result: jsonb("stage1_result"),
  stage1Error: text("stage1_error"),

  // Stage 2 (deep scan)
  stage2Status: text("stage2_status").notNull().default("pending"),
  // stage2_status values: "pending" | "running" | "complete" | "error"
  stage2Result: jsonb("stage2_result"),
  stage2Error: text("stage2_error"),
  reportBlobKey: text("report_blob_key"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})
```

### Checkout sessions table

Tracks payment state for each report unlock.

```typescript
export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),

  status: text("status").notNull().default("pending"),
  // status values: "pending" | "paid" | "expired"
  method: text("method"),
  // method values: "card" | "lightning" | null (null while pending)

  stripeIntentId: text("stripe_intent_id"),
  lnPaymentHash: text("ln_payment_hash"),
  lnVerifyUrl: text("ln_verify_url"),

  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

### DB client

```typescript
// db/index.ts
import { drizzle } from "drizzle-orm/netlify-db"
import * as schema from "./schema.js"

export const db = drizzle({ schema })
```

### Drizzle config

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "netlify/database/migrations",
})
```

### Generate migrations

After creating the schema, run:

```bash
npx drizzle-kit generate
```

This creates SQL files in `netlify/database/migrations/`. Never modify migration files once deployed. Netlify applies them automatically during deploys.

## 8. Job status polling

### `GET /api/job-status` -- `netlify/functions/job-status.mts`

The client polls this endpoint every 2-3 seconds after upload completes.

- Query param: `?id=<job_id>`
- Reads the job row from DB.
- Returns current state:

```json
{
  "job_id": "abc-123",
  "status": "processing",
  "stage1": {
    "status": "complete",
    "result": {
      "form_id": "20-18",
      "form_name": "One to Four Family Residential Contract (Resale)",
      "confidence": 92,
      "modification_count": 7,
      "red_flags": ["As-is clause with no inspection contingency", "Option period under 5 days", "Seller financing with balloon payment"],
      "terms": {
        "price": "$350,000",
        "option_period_days": 3,
        "closing_date": "2025-03-15",
        "buyer": "Jane Doe",
        "seller": "John Smith",
        "financing_type": "Seller Financing"
      }
    }
  },
  "stage2": {
    "status": "running",
    "result": null
  }
}
```

**Client polling behavior:**

1. Start polling immediately after `upload-complete` returns.
2. Poll every 3 seconds.
3. When `stage1.status === 'complete'`, render the free preview and stop the loading spinner for Stage 1. Keep polling for Stage 2.
4. When `stage2.status === 'complete'`, show the "Unlock full report" button (if not already paid). Stop polling.
5. On `status === 'error'` for either stage, show an error message and stop polling for that stage.
6. Stop all polling after 10 minutes (safety cap). Show a timeout message.

## 9. Payment flow

### Price

**$5 USD** for the full report (not $3 as in the checkout PRD -- the scanner PRD takes precedence).

### `POST /api/checkout-init` -- `netlify/functions/checkout-init.mts`

Request body: `{ job_id: string }`

1. Verify job exists and `stage2_status` is `complete` or `running` (user can pre-pay while deep scan is still running).
2. Create Stripe PaymentIntent for $5 (500 cents).
3. Fetch BTC/USD spot price from Coinbase API: `GET https://api.coinbase.com/v2/prices/BTC-USD/spot`
4. Compute sats: `Math.round(5.00 / price_per_btc * 100_000_000)`
5. Fetch Lightning invoice from Alby LNURL-pay endpoint (see checkout PRD section 7 for the `fetchLnurlInvoice` implementation).
6. Insert checkout session row in DB.
7. Return:

```json
{
  "session_id": "uuid",
  "stripe_client_secret": "pi_xxx_secret_xxx",
  "ln_invoice": "lnbc...",
  "ln_amount_sats": 8345
}
```

### `GET /api/checkout-status` -- `netlify/functions/checkout-status.mts`

Query param: `?session_id=X`

1. Read checkout session from DB.
2. If `status === 'paid'`, generate a signed download token (HMAC of `session_id + expiry`, 24-hour TTL) and return `{ status: 'paid', download_token: '...' }`.
3. If pending and Lightning verify URL exists, check it (GET the `ln_verify_url`). If `settled === true`, update DB to `paid`, `method = 'lightning'`, set `paid_at`.
4. Otherwise return `{ status: 'pending' }`.

**Download token generation:**

```typescript
import { createHmac } from 'node:crypto'

function signToken(sessionId: string): string {
  const expiry = Date.now() + 86_400_000 // 24 hours
  const payload = `${sessionId}:${expiry}`
  const sig = createHmac('sha256', Netlify.env.get('DOWNLOAD_TOKEN_SECRET'))
    .update(payload)
    .digest('hex')
  return Buffer.from(`${payload}:${sig}`).toString('base64url')
}

function verifyToken(token: string): string | null {
  const decoded = Buffer.from(token, 'base64url').toString()
  const [sessionId, expiryStr, sig] = decoded.split(':')
  const expiry = parseInt(expiryStr, 10)
  if (Date.now() > expiry) return null
  const expected = createHmac('sha256', Netlify.env.get('DOWNLOAD_TOKEN_SECRET'))
    .update(`${sessionId}:${expiryStr}`)
    .digest('hex')
  if (sig !== expected) return null
  return sessionId
}
```

### `POST /api/stripe-webhook` -- `netlify/functions/stripe-webhook.mts`

Stripe webhook endpoint. Configured in Stripe dashboard.

1. Verify the webhook signature using `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)`. **Critical:** use `await req.text()` for the raw body before verifying. Do not `JSON.parse` first.
2. On `payment_intent.succeeded`, extract `session_id` from `event.data.object.metadata`.
3. Update checkout session in DB: `status = 'paid'`, `method = 'card'`, `paid_at = now()`.
4. Return `200 OK`.

### `GET /api/report` -- `netlify/functions/report.mts`

Returns report data (JSON) and optionally the downloadable PDF.

Query params: `?id=<job_id>&token=<download_token>&format=json|pdf`

**Without token (free tier):**
- Returns `stage1_result` only.

**With valid token (paid tier):**
- `format=json` (default): returns full `stage2_result` as JSON.
- `format=pdf`: streams the generated PDF report from Blobs. Sets `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="trec-report.pdf"`, `Cache-Control: private, no-store`.

Token validation: verify the HMAC token, look up the checkout session in DB, confirm it is `paid`, confirm the `job_id` on the checkout session matches the requested job.

## 10. Frontend specification

A single `index.html` file at the project root with associated JS modules. No build step. No framework.

### Files

```
index.html          -- the page
js/app.js           -- main application logic
js/upload.js        -- chunked upload handler
js/checkout.js      -- Stripe + Lightning payment logic
js/poll.js          -- job status and checkout status polling
```

### Required external scripts

```html
<script src="https://js.stripe.com/v3/"></script>
```

The `qrcode` package should be bundled or loaded from a CDN for Lightning QR codes.

### Functional requirements (no styling specified)

#### Drop zone

- A prominent drop area that accepts drag-and-drop of a single PDF file.
- Also a click-to-browse fallback.
- Validate client-side: must be `application/pdf`, must be <= 10 MB. Show error inline if invalid.
- On valid file drop, immediately begin the chunked upload flow.

#### Upload progress

- Show a progress indicator as chunks upload (e.g., "Uploading: 2/3 chunks...").
- On completion, transition to the scanning state.

#### Scanning / processing state

- Show "Analyzing your contract..." with a loading indicator.
- Begin polling `/api/job-status` every 3 seconds.

#### Free preview (Stage 1 results)

When `stage1.status === 'complete'`, render:

- Detected TREC form name and confidence score (e.g., "20-18 One to Four Family Residential Contract (Resale) -- 92% confidence")
- Number of modifications detected (e.g., "7 modifications detected vs. standard form")
- Top 3 red flag titles as a bullet list
- Basic terms table: price, option period, closing date, buyer, seller, financing type
- Prominent legal disclaimer: "This is not legal advice. This tool is not a substitute for a licensed attorney. See full disclaimer below."

If Stage 2 is still running, show "Full analysis in progress..." with a secondary loading indicator.

#### Unlock button

- "Unlock full report -- $5" button appears once Stage 1 results are visible.
- User can click this even if Stage 2 is still running (they can pre-pay).
- Clicking opens the checkout modal/section.

#### Checkout UI

A section (modal or inline expansion) with two tabs:

**Card tab:**
- Stripe Payment Element (inline form -- card number, expiry, CVC).
- "Pay $5" button.
- Error display area.
- On successful confirmation via `stripe.confirmPayment()` with `redirect: 'if_required'`, begin polling `/api/checkout-status` every 2 seconds.

**Lightning tab:**
- QR code of the Lightning invoice.
- Display: "{sats} sats (~$5.00)".
- "Copy invoice" button (copies the `ln_invoice` string to clipboard).
- `lightning:{invoice}` tap-to-pay link for mobile wallets.
- "Waiting for payment..." status text.
- Auto-poll `/api/checkout-status` every 2 seconds while this tab is visible.
- If the invoice sits open for 9+ minutes, show a "Refresh invoice" button that calls `/api/checkout-init` again.

#### Post-payment

On `checkout-status` returning `status: 'paid'`:
- If Stage 2 is complete: render the full report inline and show a "Download PDF" button linking to `/api/report?id={job_id}&token={token}&format=pdf`.
- If Stage 2 is still running: show "Payment confirmed. Full report is still being generated..." and continue polling `/api/job-status`. When Stage 2 completes, render the report and download button.

#### Full report display (paid)

Render the `stage2_result` JSON inline on the page:

- Section: "Modifications Found" -- for each modification:
  - Standard form text vs. contract text (side by side or stacked)
  - Plain-English explanation
  - Risk badge: low (green), medium (yellow), high (red)
  - Suggested questions to ask
- Section: "Full Terms Summary" -- complete term-by-term breakdown
- "Download PDF Report" button

#### Error states

- Upload failure: "Upload failed. Please try again." with a retry option (re-show drop zone).
- Stage 1 error: "Analysis failed. Please try re-uploading your contract."
- Stage 2 error: "Full analysis could not be completed. Your quick summary is still available above." (don't block the free preview)
- Payment error: Stripe error message displayed inline. Lightning timeout message with refresh option.

#### Legal disclaimer

A persistent disclaimer at the bottom of the page:

> This tool provides automated analysis of TREC contract forms and is NOT legal advice. It is not a substitute for review by a licensed Texas real estate attorney. No attorney-client relationship is created by using this tool. Contracts are not stored beyond the active session. This tool covers Texas TREC forms only.

#### No-recovery note

There are no user accounts. If a user pays and closes the tab, they lose access. Mitigation: after payment, display a recovery URL (`/?job={job_id}&token={download_token}`) and instruct the user to bookmark it. The page should check URL params on load and restore the paid report view if a valid token is present.

## 11. Blob storage layout

| Store name | Key pattern | Contents |
|------------|-------------|----------|
| `uploads` | `{job_id}/chunk-{N}` | Temporary upload chunks (deleted after assembly) |
| `uploads` | `{job_id}/contract.pdf` | Assembled PDF file |
| `reports` | `{job_id}/full-report.pdf` | Generated PDF report (paid tier) |

Clean up: uploaded PDFs and reports should be deleted after 24 hours. Implement a scheduled function for this (see section 14).

## 12. Environment variables

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...         # Exposed to client via inline script or meta tag
STRIPE_WEBHOOK_SECRET=whsec_...
ALBY_LN_ADDRESS=yourname@getalby.com
DOWNLOAD_TOKEN_SECRET=<random 32+ bytes>
SITE_URL=https://trex-contracts.netlify.app  # Used for internal function-to-function calls
```

Netlify AI Gateway variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`) are injected automatically. Do not set these manually.

The `STRIPE_PUBLISHABLE_KEY` must be available client-side. Expose it via a `<meta>` tag in `index.html` that a serverless function or edge function injects, or hardcode the publishable key directly (it is safe to expose -- that is its purpose).

## 13. Netlify configuration

### `netlify.toml`

```toml
[build]
  publish = "."

[functions]
  node_bundler = "esbuild"
```

No special edge function config needed. No redirects needed (functions use `config.path` for routing).

## 14. Scheduled cleanup function

### `netlify/functions/cleanup-expired.mts`

Runs daily. Deletes jobs older than 24 hours and their associated Blobs.

```typescript
import type { Config } from '@netlify/functions'
import { db } from '../../db/index.js'
import { jobs, checkoutSessions } from '../../db/schema.js'
import { lt } from 'drizzle-orm'
import { getStore } from '@netlify/blobs'

export default async (req: Request) => {
  const cutoff = new Date(Date.now() - 86_400_000)
  const expiredJobs = await db
    .select()
    .from(jobs)
    .where(lt(jobs.createdAt, cutoff))

  const uploads = getStore('uploads')
  const reports = getStore('reports')

  for (const job of expiredJobs) {
    // Delete blobs
    try { await uploads.delete(`${job.id}/contract.pdf`) } catch {}
    try { await reports.delete(`${job.id}/full-report.pdf`) } catch {}
    // Delete checkout sessions for this job
    await db.delete(checkoutSessions).where(eq(checkoutSessions.jobId, job.id))
    // Delete job
    await db.delete(jobs).where(eq(jobs.id, job.id))
  }
}

export const config: Config = {
  schedule: '@daily',
}
```

## 15. Complete function inventory

| File | Type | Path | Purpose |
|------|------|------|---------|
| `netlify/functions/upload-init.mts` | Sync | `POST /api/upload-init` | Validate file metadata, create job row |
| `netlify/functions/upload-chunk.mts` | Sync | `POST /api/upload-chunk` | Receive and store one upload chunk |
| `netlify/functions/upload-complete.mts` | Sync | `POST /api/upload-complete` | Assemble chunks, trigger scans |
| `netlify/functions/quick-scan-background.mts` | Background | (default path) | Stage 1 fast AI scan |
| `netlify/functions/deep-scan-background.mts` | Background | (default path) | Stage 2 deep AI scan |
| `netlify/functions/job-status.mts` | Sync | `GET /api/job-status` | Poll job/scan progress |
| `netlify/functions/checkout-init.mts` | Sync | `POST /api/checkout-init` | Create Stripe intent + LN invoice |
| `netlify/functions/checkout-status.mts` | Sync | `GET /api/checkout-status` | Poll payment status |
| `netlify/functions/stripe-webhook.mts` | Sync | `POST /api/stripe-webhook` | Stripe payment confirmation |
| `netlify/functions/report.mts` | Sync | `GET /api/report` | Serve free/paid report data + PDF |
| `netlify/functions/cleanup-expired.mts` | Scheduled | N/A (`@daily`) | Delete old jobs and blobs |

## 16. NPM packages to install

```bash
npm install @netlify/database @netlify/blobs @netlify/functions @anthropic-ai/sdk stripe pdf-parse qrcode
npm install drizzle-orm@beta
npm install -D drizzle-kit@beta @types/pdf-parse @netlify/edge-functions typescript
```

## 17. Standard TREC forms reference data

The AI prompts need to reference standard TREC form text for comparison. For v1, include the TREC form names and numbers in the prompt (listed in section 6 prompt examples). The AI model has knowledge of these standard forms.

For future accuracy improvements: download the published TREC form PDFs, extract their text, and store in Blobs or as static files. Include the relevant standard form text in the Stage 2 prompt for direct comparison. This is out of scope for v1 but the schema and blob storage layout support it.

## 18. Build order for implementing agent

1. **Project scaffold**: `package.json`, `netlify.toml`, `.gitignore` (include `node_modules`), install all packages.
2. **Database**: `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`. Run `npx drizzle-kit generate`.
3. **Upload flow**: `upload-init.mts`, `upload-chunk.mts`, `upload-complete.mts`. Test with a small PDF.
4. **Quick scan**: `quick-scan-background.mts`. Test with a real TREC contract PDF if available, otherwise any PDF.
5. **Deep scan**: `deep-scan-background.mts`. Same test approach.
6. **Job status**: `job-status.mts`. Verify polling returns correct state transitions.
7. **Frontend: upload + preview**: `index.html`, `js/app.js`, `js/upload.js`, `js/poll.js`. Wire up drop zone through to Stage 1 results display.
8. **Checkout: Stripe**: `checkout-init.mts`, `stripe-webhook.mts`, `checkout-status.mts`. Test with Stripe test mode.
9. **Checkout: Lightning**: Add LN invoice creation to `checkout-init.mts`, LN polling to `checkout-status.mts`. Test with Alby.
10. **Frontend: checkout UI**: `js/checkout.js`. Wire up card and Lightning tabs.
11. **Report delivery**: `report.mts`. Wire up paid report display and PDF download.
12. **Cleanup**: `cleanup-expired.mts`.
13. **Legal disclaimer**: Add to `index.html`.
14. **Recovery URL**: Implement URL param detection on page load.

## 19. Gotchas and constraints

- **Background function payloads are limited to 256 KB.** The `quick-scan-background` and `deep-scan-background` functions receive only `{ job_id }` in the request body. They read the actual PDF from Blobs, not from the request.
- **Stripe webhook body must be raw text.** Use `await req.text()` before signature verification. Do not `JSON.parse` first.
- **Drizzle ORM requires `@beta` dist-tag.** `drizzle-orm@beta` and `drizzle-kit@beta` -- the `latest` tag does not include the Netlify Database adapter.
- **Migration output directory must be `netlify/database/migrations`.** Set `out` in `drizzle.config.ts`. The default `drizzle/` directory will not be picked up by Netlify.
- **Import paths need `.js` extensions.** TypeScript with ES modules requires `from "./schema.js"` even though the source file is `.ts`.
- **Lightning invoice expiry is ~10 minutes.** Show a refresh button after 9 minutes.
- **No accounts = no recovery.** The recovery URL pattern (section 10) is the only mitigation.
- **PDF report generation in Stage 2.** Use a library like `pdfkit` or `jspdf` to generate the downloadable report. Add to package list if needed. This runs inside the background function so there are no timeout concerns.
- **Netlify AI Gateway requires at least one production deploy.** The implementing agent should deploy once before testing AI calls.
- **AI Gateway context window limit is 200k tokens.** Very large contracts (50+ pages) may exceed this. The implementing agent should truncate or chunk the text if it exceeds ~180k tokens and note this as a known limitation.
- **Idempotency:** If both Stripe and Lightning are paid for the same session (unlikely edge case), just deliver the report. Don't auto-refund. Mark as paid on the first confirmation and ignore subsequent ones.
- **Strong consistency for checkout sessions.** Use `{ consistency: 'strong' }` when reading checkout session data from Blobs (if Blobs were used). Since we use the database for sessions, this is handled by Postgres transactional reads.

## 20. What this PRD deliberately does NOT cover

- Visual design, CSS, colors, typography, spacing, layout, animations (separate design agent)
- User accounts or authentication
- Email delivery of reports
- History of past uploads
- Non-TREC or non-Texas contracts
- Contract editing, annotation, or signing
- Negotiation suggestions or counter-offer drafting
- Tax handling
- Refund flow (manual via Stripe dashboard; LN is non-refundable)
- Analytics or tracking
- A/B testing of pricing
- Coupon codes
