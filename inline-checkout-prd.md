# Inline Polar + BTC Checkout: Minimal PRD

> **Implementation note (post-swap):** the card rail is now Polar (merchant of record) using `@polar-sh/checkout` embedded overlay rather than Stripe Payment Element. The rest of the architecture below is still accurate; treat any `Stripe`/`stripe-webhook`/`STRIPE_*` references in the historical sections as `Polar`/`polar-webhook`/`POLAR_*`.

A thin, two-rail paywall for a $3 PDF unlock. Card payments use Polar's embedded overlay (Polar is merchant of record). Lightning shows an invoice QR. No third-party SaaS subscription. No user accounts.

## 1. Goal

Add a single inline checkout to the report page that:

1. Accepts $3 USD via card (Stripe, inline)
2. Accepts ~equivalent sats via Lightning (Alby Lightning Address)
3. On payment, unlocks the full PDF for that session

Total surface area target: one HTML/JS frontend file, three serverless functions, one KV store.

## 2. Non-goals

- No accounts, login, or "your library"
- No subscriptions or recurring billing
- No multi-product catalog
- No on-chain BTC (Lightning only on the BTC side)
- No fiat conversion of received sats (let them sit in the Lightning wallet)
- No invoice/receipt emails (Stripe sends its own; LN is anonymous)

## 3. User flow

```
[Free summary visible]
        |
        v
[Unlock full report: $3]    <-- single button
        |
        v
+-------------------------------+
| (•) Card    ( ) Lightning     |
|                               |
|  [card number] [exp] [cvc]    |  <-- Stripe Payment Element, inline
|                               |
|  [Pay $3]                     |
+-------------------------------+
        |
        v (success)
[PDF downloads automatically + link stays visible for ~10 min]
```

Lightning side toggles to:

```
+-------------------------------+
| ( ) Card    (•) Lightning     |
|                               |
|     [QR code]                 |
|     5,247 sats (~$3.00)       |
|     [Copy invoice]            |
|     Waiting for payment...    |
+-------------------------------+
```

## 4. Architecture

```
┌─────────────────┐
│ report.html     │  Static page on Netlify
│ + checkout.js   │  Vanilla JS, Stripe.js, QR lib
└────────┬────────┘
         │
         ├─POST /api/checkout-init ──> creates Stripe PaymentIntent
         │                              + fetches LN invoice from Alby
         │                              + writes session to Netlify Blobs
         │
         ├─GET /api/checkout-status ─> reads session from Blobs
         │  (polled every 2s on LN)    + checks Alby for LN payment if pending
         │
         ├─POST /api/stripe-webhook ──> Stripe POSTs here on success,
         │                              flips session to paid
         │
         └─GET /api/download?t=... ──> validates signed token, streams PDF
```

## 5. Stack

| Piece | Choice | Why |
|---|---|---|
| Hosting | Netlify (existing) | Already there |
| Backend | Netlify Functions | No new infra |
| Storage | Netlify Blobs | Already used for Casa, free tier covers this |
| Cards | Stripe Payment Element | Inline, no redirect |
| Lightning | Alby Lightning Address | Free, simple LNURL-pay flow, has status API |
| QR rendering | `qrcode` npm package (or `qrcode-svg` for zero-dep) | Trivial |
| PDF protection | Signed token + private bucket (or one-shot URL) | Stops sharing |

## 6. Pricing the Lightning invoice

Lightning prices need to be in sats, not dollars. Two acceptable approaches:

**Option A (simplest): fixed sats price, refresh daily.**
Set `LIGHTNING_PRICE_SATS = 5000` (or whatever ~$3 is). Update via env var. Slight under/over-charging during volatility is fine for a $3 product.

**Option B (better): live conversion at invoice creation.**
Call Coinbase's spot price endpoint on each invoice creation:

```
GET https://api.coinbase.com/v2/prices/BTC-USD/spot
```

Compute `sats = round(3.00 / price_usd_per_btc * 100_000_000)`. The invoice is only valid for ~10 minutes anyway, so price drift mid-payment is bounded.

Go with B if you want clean pricing. A if you want zero dependencies.

## 7. Backend functions

### `POST /api/checkout-init`

Creates everything the client needs.

```js
// netlify/functions/checkout-init.js
import Stripe from 'stripe';
import { getStore } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ALBY_LN_ADDRESS = 'yourname@getalby.com';

export default async (req) => {
  const sessionId = randomUUID();

  // 1. Stripe PaymentIntent for $3
  const intent = await stripe.paymentIntents.create({
    amount: 300,
    currency: 'usd',
    metadata: { session_id: sessionId },
    automatic_payment_methods: { enabled: true },
  });

  // 2. Lightning invoice via LNURL-pay flow
  const sats = await usdToSats(3.00);
  const lnInvoice = await fetchLnurlInvoice(ALBY_LN_ADDRESS, sats);

  // 3. Persist session
  const store = getStore('checkout');
  await store.setJSON(sessionId, {
    status: 'pending',
    stripe_intent_id: intent.id,
    ln_payment_hash: lnInvoice.payment_hash,
    ln_verify_url: lnInvoice.verify, // LUD-21, Alby supports this
    created_at: Date.now(),
  });

  return Response.json({
    session_id: sessionId,
    stripe_client_secret: intent.client_secret,
    ln_invoice: lnInvoice.pr,
    ln_amount_sats: sats,
  });
};
```

`fetchLnurlInvoice` does the standard two-hop LNURL-pay dance:

```js
async function fetchLnurlInvoice(lnAddress, sats) {
  const [user, domain] = lnAddress.split('@');
  const meta = await fetch(`https://${domain}/.well-known/lnurlp/${user}`).then(r => r.json());
  const callback = `${meta.callback}?amount=${sats * 1000}`; // millisats
  return fetch(callback).then(r => r.json()); // returns { pr, verify, ... }
}
```

### `GET /api/checkout-status?session_id=X`

Client polls this every 2 seconds while the LN tab is open. (Card path doesn't need polling: Stripe.js confirms inline.)

```js
export default async (req) => {
  const sessionId = new URL(req.url).searchParams.get('session_id');
  const store = getStore('checkout');
  const session = await store.get(sessionId, { type: 'json' });

  if (!session) return Response.json({ status: 'not_found' }, { status: 404 });
  if (session.status === 'paid') {
    return Response.json({ status: 'paid', download_token: signToken(sessionId) });
  }

  // Lazy-check Lightning via LUD-21 verify URL
  if (session.ln_verify_url) {
    const v = await fetch(session.ln_verify_url).then(r => r.json());
    if (v.settled) {
      session.status = 'paid';
      session.method = 'lightning';
      session.paid_at = Date.now();
      await store.setJSON(sessionId, session);
      return Response.json({ status: 'paid', download_token: signToken(sessionId) });
    }
  }

  return Response.json({ status: 'pending' });
};
```

### `POST /api/stripe-webhook`

Stripe-side path: webhook fires when card payment confirms. Flip the session.

```js
export default async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  if (event.type === 'payment_intent.succeeded') {
    const sessionId = event.data.object.metadata.session_id;
    const store = getStore('checkout');
    const session = await store.get(sessionId, { type: 'json' });
    if (session) {
      session.status = 'paid';
      session.method = 'card';
      session.paid_at = Date.now();
      await store.setJSON(sessionId, session);
    }
  }

  return new Response('ok');
};
```

Configure the webhook URL in Stripe dashboard, save the signing secret to `STRIPE_WEBHOOK_SECRET`.

### `GET /api/download?t=X`

Validates the signed token and streams the PDF. Token = HMAC of `session_id + expiry`, ~10 min TTL. PDF file lives in a private location (Netlify Blob, R2, S3) so direct URL guessing fails.

```js
export default async (req) => {
  const token = new URL(req.url).searchParams.get('t');
  const sessionId = verifyToken(token); // throws if invalid/expired
  if (!sessionId) return new Response('forbidden', { status: 403 });

  const store = getStore('reports', { siteID: ..., token: ... }); // private store
  const pdf = await store.get('full-report.pdf', { type: 'arrayBuffer' });
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="full-report.pdf"',
    },
  });
};
```

## 8. Frontend

One file. Vanilla JS, Stripe.js loaded from CDN, optional QR lib.

```html
<button id="unlock">Unlock full report: $3</button>

<dialog id="checkout">
  <div class="tabs">
    <button data-tab="card" class="active">Card</button>
    <button data-tab="lightning">⚡ Lightning</button>
  </div>

  <div id="card-pane">
    <div id="payment-element"></div>
    <button id="pay-card">Pay $3</button>
    <div id="card-error"></div>
  </div>

  <div id="ln-pane" hidden>
    <canvas id="qr"></canvas>
    <div id="ln-amount"></div>
    <button id="copy-invoice">Copy invoice</button>
    <div id="ln-status">Waiting for payment...</div>
  </div>
</dialog>

<script src="https://js.stripe.com/v3/"></script>
<script type="module" src="/checkout.js"></script>
```

```js
// checkout.js (sketch)
const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
let session, elements, pollHandle;

document.getElementById('unlock').onclick = async () => {
  const res = await fetch('/api/checkout-init', { method: 'POST' }).then(r => r.json());
  session = res;

  // Stripe Element
  elements = stripe.elements({ clientSecret: res.stripe_client_secret });
  elements.create('payment').mount('#payment-element');

  // Lightning QR (lazy: only render on tab switch)
  document.getElementById('ln-amount').textContent = `${res.ln_amount_sats.toLocaleString()} sats (~$3.00)`;

  document.getElementById('checkout').showModal();
};

document.getElementById('pay-card').onclick = async () => {
  const { error } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: window.location.href },
    redirect: 'if_required',
  });
  if (error) {
    document.getElementById('card-error').textContent = error.message;
  } else {
    // Card succeeded inline. Webhook will flip server state. Poll once or twice.
    await pollUntilPaid();
  }
};

document.querySelector('[data-tab="lightning"]').onclick = () => {
  swapTab('lightning');
  renderQr(session.ln_invoice);
  startPolling();
};

async function pollUntilPaid() {
  pollHandle = setInterval(async () => {
    const r = await fetch(`/api/checkout-status?session_id=${session.session_id}`).then(r => r.json());
    if (r.status === 'paid') {
      clearInterval(pollHandle);
      window.location = `/api/download?t=${r.download_token}`;
    }
  }, 2000);
}

function startPolling() { pollUntilPaid(); }
```

## 9. Environment variables

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
ALBY_LN_ADDRESS=yourname@getalby.com
DOWNLOAD_TOKEN_SECRET=<random 32 bytes>
```

(No Alby API key needed for the public LNURL-pay + LUD-21 verify flow.)

## 10. Build order (one afternoon)

1. Stripe account + test mode keys, $3 PaymentIntent working in `curl` (~15 min)
2. Alby account, confirm LNURL-pay returns valid invoice via `curl` (~10 min)
3. `checkout-init` function returning both, tested in Postman (~30 min)
4. Frontend modal with Stripe Element rendering and confirming (test card) (~45 min)
5. Lightning QR + polling + LUD-21 verify (~45 min)
6. Stripe webhook + `checkout-status` flipping state (~30 min)
7. Signed token + `/download` endpoint streaming PDF (~30 min)
8. Switch Stripe to live keys, test with a real card and real LN payment (~15 min)

Total: ~3.5 hours of focused work.

## 11. Gotchas

- **Stripe webhook on Netlify:** the body must be the raw string for signature verification. Netlify Functions v2 gives you `req.text()` which is correct. Don't `JSON.parse` first.
- **LUD-21 (verify URL):** Alby supports it, but not every LN provider does. If you ever swap to a wallet that doesn't, you'll need to switch to NWC (Nostr Wallet Connect) or webhook-based confirmation. Verify Alby's `verify` field is present in the response before assuming.
- **Lightning invoice expiry:** typically 10 minutes. If the modal sits open longer, refresh the invoice. Easiest: regenerate on tab focus or via "Refresh invoice" button after 9 minutes.
- **Mobile Lightning UX:** users on mobile with a Lightning wallet installed expect a `lightning:` URI link (tap to open wallet). Add `<a href="lightning:${invoice}">` next to the QR.
- **Idempotency:** if a user pays the LN invoice and the card at the same time (unlikely but possible), both webhooks fire. Don't refund the second one automatically. Just deliver the PDF and check the session is already `paid` before reprocessing.
- **PDF caching:** set `Cache-Control: private, no-store` on the download response. Otherwise the signed URL might be cached and shared.
- **Stripe at $3:** net is ~$2.61 after 30¢ + 2.9%. Lightning net is ~$3.00 minus routing fees (typically <1 sat). Worth knowing for revenue math.
- **No accounts means no recovery:** if a user pays and closes the tab before download, they lose access. Mitigation: keep `paid` sessions valid for ~24 hours, give them a recovery URL displayed after payment (`/r/<session_id>` page that re-issues the download token if session is `paid`).
- **Stripe disputes:** chargebacks happen even on $3 charges. Stripe charges $15 dispute fees. Lightning can't be charged back. Worth knowing as you scale.

## 12. What this deliberately leaves out

- Email receipts (Stripe sends one if you enable it; LN side gets nothing, which is fine for $3)
- Tax handling (Stripe Tax is a separate flag; not worth it at this volume)
- Refund flow (manual via Stripe dashboard if needed; LN refunds require a return invoice)
- Analytics (drop in PostHog or Plausible later if you care)
- A/B-able pricing (hardcoded $3 / 5000 sats; change via env var if needed)
- Coupon codes
- Multiple products (this is single-PDF only; generalize later if it works)

## 13. Future enhancements (only if traffic justifies)

- Swap Alby for self-hosted LNbits or Alby Hub for full self-custody on the LN side
- Add NWC support for one-click Lightning payments from compatible wallets (no QR scan)
- Add an on-chain BTC option via the same LNURL-pay endpoint (Alby supports onchain fallback)
- Pre-generate PDFs per-buyer with a watermark (deters resharing)
- Move to Zaprite if monthly volume comfortably exceeds 10 sales (cleaner unified checkout, $25/mo break-even)
