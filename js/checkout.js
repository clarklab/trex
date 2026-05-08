// Checkout flow: Polar embedded checkout + Lightning.
//
// Speed strategy:
//   1. Show the dialog immediately so the coupon path works without delay.
//   2. Fetch checkout-init in parallel; reveal Pay button when ready.
//   3. Lazy-load the LN invoice only if the user clicks the Lightning tab.

import { pollCheckoutStatus } from "/js/poll.js";

let session = null;
let stopPolling = null;
let polarHandle = null;

export async function openCheckout(jobId, tier, onPaid, onError) {
  resetState();
  const dialog = document.getElementById("checkout-dialog");

  // 1) Render the static parts of the dialog and open it immediately.
  const titleEl = document.querySelector("#checkout-dialog h2");
  const subEl = document.querySelector("#checkout-dialog .dialog-sub");
  const payBtn = document.getElementById("pay-card");
  if (tier === "panel") {
    if (titleEl) titleEl.textContent = "Unlock panel review";
    if (subEl) subEl.textContent = "$12.00 USD — three frontier AIs review your contract.";
    if (payBtn) payBtn.textContent = "Loading…";
  } else {
    if (titleEl) titleEl.textContent = "Unlock full report";
    if (subEl) subEl.textContent = "$5.00 USD — one-time, no account.";
    if (payBtn) payBtn.textContent = "Loading…";
  }
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.onclick = null;
  }

  // Hide LN tab until we know if it's available.
  const lnTab = document.getElementById("ln-tab");
  if (lnTab) lnTab.hidden = true;

  setupTabs();
  setupCoupon(jobId, tier, onPaid);

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => {
      if (stopPolling) stopPolling();
      if (polarHandle && typeof polarHandle.close === "function") {
        try { polarHandle.close(); } catch {}
      }
      dialog.close();
    };
  });

  dialog.showModal();

  // 2) Fetch checkout-init in the background. Only the card and LN paths
  //    depend on this — the coupon path is already wired up.
  let initData;
  try {
    const res = await fetch("/api/checkout-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, tier }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `checkout-init ${res.status}`);
    }
    initData = await res.json();
  } catch (err) {
    // Don't blow away the dialog — the coupon path may still work.
    const errEl = document.getElementById("card-error");
    if (errEl) {
      errEl.textContent = (err && err.message) || "Failed to initialize checkout";
      errEl.hidden = false;
    }
    if (payBtn) payBtn.textContent = tier === "panel" ? "Pay $12 with card" : "Pay $5 with card";
    return;
  }
  session = initData;

  if (!session.polar_checkout_url) {
    const errEl = document.getElementById("card-error");
    if (errEl) {
      errEl.textContent = "Polar checkout is not configured on the server";
      errEl.hidden = false;
    }
    return;
  }

  // 3) Card path is ready — enable Pay button.
  if (payBtn) {
    payBtn.disabled = false;
    payBtn.textContent = tier === "panel" ? "Pay $12 with card" : "Pay $5 with card";
    payBtn.onclick = () => openPolarOverlay(onPaid, onError);
  }

  // 4) LN tab: show only if backend advertises availability. Don't fetch
  //    the invoice until the user clicks the tab.
  if (session.ln_available && lnTab) {
    lnTab.hidden = false;
    setupLightningLazy(onPaid, onError, tier);
  }
}

async function openPolarOverlay(onPaid, onError) {
  const errEl = document.getElementById("card-error");
  if (errEl) errEl.hidden = true;

  // Polar @0.2.0 CDN script exposes window.Polar.EmbedCheckout.
  // Older versions used window.PolarEmbedCheckout — fall back for safety.
  const PolarEmbed =
    (typeof window.Polar === "object" && window.Polar?.EmbedCheckout) ||
    window.PolarEmbedCheckout;
  if (!PolarEmbed || typeof PolarEmbed.create !== "function") {
    onError(new Error("Polar embed script not loaded"));
    return;
  }

  try {
    polarHandle = await PolarEmbed.create(
      session.polar_checkout_url,
      { theme: "dark" },
    );
  } catch (err) {
    if (errEl) {
      errEl.textContent = err && err.message ? err.message : "Failed to open checkout";
      errEl.hidden = false;
    }
    return;
  }

  const onSuccess = () => {
    if (stopPolling) stopPolling();
    stopPolling = pollCheckoutStatus(
      session.session_id,
      (data) => {
        try { polarHandle && polarHandle.close && polarHandle.close(); } catch {}
        document.getElementById("checkout-dialog").close();
        onPaid(data);
      },
      onError,
    );
  };

  polarHandle.addEventListener("success", onSuccess);
  polarHandle.addEventListener("close", () => {
    polarHandle = null;
  });
}

function setupCoupon(jobId, tier, onPaid) {
  const toggle = document.getElementById("coupon-toggle");
  const form = document.getElementById("coupon-form");
  const input = document.getElementById("coupon-input");
  const apply = document.getElementById("coupon-apply");
  const errEl = document.getElementById("coupon-error");
  if (!toggle || !form || !input || !apply) return;

  // Reset to closed state on each open.
  form.hidden = true;
  input.value = "";
  if (errEl) errEl.hidden = true;

  toggle.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) input.focus();
  };

  const submit = async () => {
    const code = input.value.trim();
    if (!code) {
      if (errEl) {
        errEl.textContent = "Enter a code";
        errEl.hidden = false;
      }
      return;
    }
    if (errEl) errEl.hidden = true;
    apply.disabled = true;
    const origLabel = apply.textContent;
    apply.textContent = "Applying…";
    try {
      const res = await fetch("/api/redeem-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, tier, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "paid") {
        const msg = data.error || `Redemption failed (${res.status})`;
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
        return;
      }
      if (polarHandle && typeof polarHandle.close === "function") {
        try { polarHandle.close(); } catch {}
      }
      const dialog = document.getElementById("checkout-dialog");
      if (dialog && dialog.open) dialog.close();
      onPaid(data);
    } catch (err) {
      if (errEl) {
        errEl.textContent = (err && err.message) || "Network error";
        errEl.hidden = false;
      }
    } finally {
      apply.disabled = false;
      apply.textContent = origLabel;
    }
  };

  apply.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((btn) => {
    btn.onclick = () => {
      tabs.forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      const which = btn.dataset.tab;
      document.getElementById("card-pane").hidden = which !== "card";
      document.getElementById("ln-pane").hidden = which !== "lightning";
    };
  });
}

// Lazy-load the LN invoice on first click of the Lightning tab.
function setupLightningLazy(onPaid, onError, tier) {
  const lnTabBtn = document.querySelector('[data-tab="lightning"]');
  if (!lnTabBtn) return;

  let lnLoaded = false;

  lnTabBtn.addEventListener(
    "click",
    async () => {
      if (lnLoaded) return;
      lnLoaded = true;

      const amountEl = document.getElementById("ln-amount");
      const statusEl = document.getElementById("ln-status");
      if (amountEl) amountEl.textContent = "Generating invoice…";
      if (statusEl) statusEl.textContent = "";

      try {
        const res = await fetch("/api/checkout-ln-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: session.session_id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to load LN invoice (${res.status})`);
        }
        const ln = await res.json();
        session.ln_invoice = ln.ln_invoice;
        session.ln_amount_sats = ln.ln_amount_sats;
        renderLightning(tier);
        startLightningPolling(onPaid, onError);
      } catch (err) {
        lnLoaded = false; // allow retry on next click
        if (amountEl) amountEl.textContent = "Could not load Lightning invoice";
        if (statusEl) statusEl.textContent = (err && err.message) || "";
      }
    },
  );
}

function renderLightning(tier) {
  const sats = session.ln_amount_sats;
  const usd = session.price_usd ?? (tier === "panel" ? 12 : 5);
  document.getElementById("ln-amount").textContent =
    `${sats.toLocaleString()} sats (~$${usd.toFixed(2)})`;
  document.getElementById("ln-link").href =
    `lightning:${session.ln_invoice}`;
  const statusEl = document.getElementById("ln-status");
  if (statusEl) statusEl.textContent = "Waiting for payment…";

  const canvas = document.getElementById("qr");
  if (window.QRCode) {
    window.QRCode.toCanvas(canvas, session.ln_invoice, { width: 240 }, (err) => {
      if (err) console.warn("QR render failed:", err);
    });
  }

  document.getElementById("copy-invoice").onclick = async () => {
    try {
      await navigator.clipboard.writeText(session.ln_invoice);
      const btn = document.getElementById("copy-invoice");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch (err) {
      console.warn("clipboard write failed:", err);
    }
  };
}

function startLightningPolling(onPaid, onError) {
  if (stopPolling) stopPolling();
  stopPolling = pollCheckoutStatus(
    session.session_id,
    (data) => {
      document.getElementById("checkout-dialog").close();
      onPaid(data);
    },
    onError,
  );
}

function resetState() {
  if (stopPolling) {
    stopPolling();
    stopPolling = null;
  }
  if (polarHandle && typeof polarHandle.close === "function") {
    try { polarHandle.close(); } catch {}
  }
  polarHandle = null;
  session = null;
  const errEl = document.getElementById("card-error");
  if (errEl) errEl.hidden = true;
}
