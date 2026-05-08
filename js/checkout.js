// Checkout flow: Polar embedded checkout + Lightning.

import { pollCheckoutStatus } from "/js/poll.js";

let session = null;
let stopPolling = null;
let polarHandle = null;

export async function openCheckout(jobId, tier, onPaid, onError) {
  resetState();
  const dialog = document.getElementById("checkout-dialog");

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
    session = await res.json();
  } catch (err) {
    onError(err);
    return;
  }

  const titleEl = document.querySelector("#checkout-dialog h2");
  const subEl = document.querySelector("#checkout-dialog .dialog-sub");
  const payBtn = document.getElementById("pay-card");
  if (tier === "panel") {
    if (titleEl) titleEl.textContent = "Unlock panel review";
    if (subEl) subEl.textContent = "$12.00 USD — three frontier AIs review your contract.";
    if (payBtn) payBtn.textContent = "Pay $12 with card";
  } else {
    if (titleEl) titleEl.textContent = "Unlock full report";
    if (subEl) subEl.textContent = "$5.00 USD — one-time, no account.";
    if (payBtn) payBtn.textContent = "Pay $5 with card";
  }

  if (!session.polar_checkout_url) {
    onError(new Error("Polar checkout is not configured on the server"));
    return;
  }

  if (payBtn) {
    payBtn.disabled = false;
    payBtn.onclick = () => openPolarOverlay(onPaid, onError);
  }

  const lnTab = document.getElementById("ln-tab");
  if (session.ln_available) {
    lnTab.hidden = false;
  }

  setupTabs();

  if (session.ln_available) {
    setupLightning(onPaid, onError, tier);
  }

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
}

async function openPolarOverlay(onPaid, onError) {
  const errEl = document.getElementById("card-error");
  if (errEl) errEl.hidden = true;

  if (!window.PolarEmbedCheckout || typeof window.PolarEmbedCheckout.create !== "function") {
    onError(new Error("Polar embed script not loaded"));
    return;
  }

  try {
    polarHandle = await window.PolarEmbedCheckout.create(
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

function setupLightning(onPaid, onError, tier) {
  const sats = session.ln_amount_sats;
  const usd = session.price_usd ?? (tier === "panel" ? 12 : 5);
  document.getElementById("ln-amount").textContent =
    `${sats.toLocaleString()} sats (~$${usd.toFixed(2)})`;
  document.getElementById("ln-link").href =
    `lightning:${session.ln_invoice}`;

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

  document.querySelector('[data-tab="lightning"]').addEventListener(
    "click",
    () => {
      if (stopPolling) stopPolling();
      stopPolling = pollCheckoutStatus(
        session.session_id,
        (data) => {
          document.getElementById("checkout-dialog").close();
          onPaid(data);
        },
        onError,
      );
    },
    { once: true },
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
  const errEl = document.getElementById("card-error");
  if (errEl) errEl.hidden = true;
}
