// Checkout flow: Stripe card + Lightning.

import { pollCheckoutStatus } from "/js/poll.js";

let stripe = null;
let elements = null;
let session = null;
let stopPolling = null;

export async function openCheckout(jobId, onPaid, onError) {
  resetState();
  const dialog = document.getElementById("checkout-dialog");

  try {
    const res = await fetch("/api/checkout-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
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

  if (!session.stripe_publishable_key) {
    onError(new Error("Stripe is not configured on the server"));
    return;
  }

  if (!stripe) {
    stripe = window.Stripe(session.stripe_publishable_key);
  }

  elements = stripe.elements({
    clientSecret: session.stripe_client_secret,
  });
  const paymentEl = elements.create("payment");
  paymentEl.mount("#payment-element");
  paymentEl.on("ready", () => {
    document.getElementById("pay-card").disabled = false;
  });

  const lnTab = document.getElementById("ln-tab");
  if (session.ln_available) {
    lnTab.hidden = false;
  }

  document.getElementById("pay-card").onclick = async () => {
    const errEl = document.getElementById("card-error");
    errEl.hidden = true;
    document.getElementById("pay-card").disabled = true;
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error) {
      errEl.textContent = error.message || "Card payment failed";
      errEl.hidden = false;
      document.getElementById("pay-card").disabled = false;
    } else {
      stopPolling = pollCheckoutStatus(
        session.session_id,
        (data) => {
          dialog.close();
          onPaid(data);
        },
        onError,
      );
    }
  };

  setupTabs();

  if (session.ln_available) {
    setupLightning(onPaid, onError);
  }

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => {
      if (stopPolling) stopPolling();
      dialog.close();
    };
  });

  dialog.showModal();
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

function setupLightning(onPaid, onError) {
  const sats = session.ln_amount_sats;
  document.getElementById("ln-amount").textContent =
    `${sats.toLocaleString()} sats (~$5.00)`;
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
  const errEl = document.getElementById("card-error");
  if (errEl) errEl.hidden = true;
  const paymentEl = document.getElementById("payment-element");
  if (paymentEl) paymentEl.innerHTML = "";
}
