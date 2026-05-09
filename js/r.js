// js/r.js — standalone /r/<code> dashboard controller.
//
// Reads the code from the URL path, fetches /api/r/:code, then drives
// tab switching and per-tab rendering. PDF rasterization for the
// overlay tab is lazy-imported (./r-overlay.js) on first click —
// that module doesn't exist yet (Phase 5).

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
import { initChat } from "/js/chat.js";

// Inject the floating chat FAB on the dashboard. The widget is a fixed-
// position bubble + panel that lives at <body> level — same one used on
// the upload page (/), via /js/site.js. Reveal it immediately rather
// than after the upload-page 10s delay since this page is post-upload.
initChat({ delayMs: 0 });

const $ = (id) => document.getElementById(id);

const state = {
  code: null,
  data: null,
  jobId: null,
  downloadToken: null,
  tier: null,
  paid: false,
  panelStatus: { claude: "pending", gpt: "pending", gemini: "pending" },
  panelResults: { claude: null, gpt: null, gemini: null },
  stopJobPoll: null,
  activeTab: "report",
  overlayLoaded: false,
  chatLoaded: false,
};

init();

async function init() {
  const segs = window.location.pathname.split("/").filter(Boolean);
  const code = segs[1] || null;
  if (!code) {
    renderFatal("This URL doesn't look like a valid report URL.");
    return;
  }
  state.code = code;
  setShareUrl(code);

  const params = new URLSearchParams(window.location.search);
  if (params.get("paid") === "1") {
    showPaidToast();
    history.replaceState({}, "", "/r/" + encodeURIComponent(code));
  }

  setupTabs();
  setupShareCopy();
  document.addEventListener("overlay:exit", () => activateTab("report"));

  let data;
  try {
    const res = await fetch("/api/r/" + encodeURIComponent(code));
    if (res.status === 404) {
      renderFatal("This report URL was not found. Double-check the code in the URL.");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ("Failed to load report (" + res.status + ")"));
    }
    data = await res.json();
  } catch (err) {
    insertLoaderInto("r-report-content");
    showLoaderError("single", err.message || "Failed to load report.");
    return;
  }

  state.data = data;
  state.jobId = data.job_id;
  state.downloadToken = data.download_token;
  state.tier = data.tier;
  state.paid = !!data.paid;
  if (data.panel) {
    state.panelStatus = {
      claude: data.panel.claude?.status || "pending",
      gpt: data.panel.gpt?.status || "pending",
      gemini: data.panel.gemini?.status || "pending",
    };
  }

  renderFooterMeta(data);
  gateOverlayTab(data);
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
  document.querySelectorAll(".r-tab-pane").forEach((p) => {
    p.hidden = p.dataset.pane !== which;
  });
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
  const share = $("r-share");
  if (share) share.parentNode.insertBefore(toast, share);
  setTimeout(() => toast.remove(), 8000);
}

function renderFooterMeta(data) {
  const meta = $("r-meta");
  if (!meta) return;
  const tier = data.tier === "panel" ? "Panel review"
    : data.tier === "single" ? "Single review"
      : "—";
  const stage1 = data.stage1?.result || {};
  const formLabel = stage1.form_id
    ? "TREC " + stage1.form_id + (stage1.form_name ? " · " + escapeHtml(stage1.form_name) : "")
    : "TREC form";
  const pages = stage1.page_count ? stage1.page_count + " pages" : "";
  const mods = typeof stage1.modification_count === "number"
    ? stage1.modification_count + " modification" + (stage1.modification_count === 1 ? "" : "s") + " flagged"
    : "";
  const paid = data.paid_at
    ? "Paid " + new Date(data.paid_at).toLocaleDateString()
    : "Not yet paid";
  meta.innerHTML =
    "<span>Tier: " + escapeHtml(tier) + "</span>" +
    "<span>" + paid + "</span>" +
    "<span>Form: " + formLabel + (pages ? " · " + pages : "") + (mods ? " · " + mods : "") + "</span>";
}

function renderFatal(msg) {
  const main = document.querySelector(".r-main");
  if (main) {
    main.innerHTML =
      '<div class="r-disclaimer" style="background:#FDECEC;border-color:#F5C6C6;color:#8B1A1A">' +
      escapeHtml(msg) +
      "</div>";
  }
}

function insertLoaderInto(targetId) {
  const loader = $("generating-loader");
  const target = $(targetId);
  if (loader && target) target.appendChild(loader);
}

// ---- Report tab ----
function renderReportTab() {
  const target = $("r-report-content");
  if (!state.data) return;
  if (!state.paid) {
    target.innerHTML =
      '<div class="r-disclaimer" style="background:#FFF;border:1px solid var(--hair);color:var(--slate)">' +
      'This URL is for an unpaid report. Return to <a href="/">trexlawyer.com</a> to upload again.' +
      "</div>";
    return;
  }

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

  if (state.tier === "panel") {
    const anyResult =
      state.data.panel?.claude?.result ||
      state.data.panel?.gpt?.result ||
      state.data.panel?.gemini?.result;
    if (anyResult) {
      target.innerHTML = panelReportHtml();
      paintPanelResults(state.data);
      hideGeneratingLoader();
      const allDone = ["claude", "gpt", "gemini"].every((k) =>
        state.panelStatus[k] === "complete" || state.panelStatus[k] === "error"
      );
      if (!allDone) startPolling();
    } else {
      insertLoaderInto("r-report-content");
      showGeneratingLoader("panel");
      startPolling();
    }
  }
}

function singleReportHtml() {
  return [
    '<div class="full-report-actions">',
    '  <a class="btn primary r-download-pdf" target="_blank" rel="noopener">Download PDF</a>',
    "</div>",
    "<h3>Summary</h3>",
    '<p id="report-summary"></p>',
    "<h3>Modifications</h3>",
    '<div id="report-mods"></div>',
    "<h3>Full Terms</h3>",
    '<table id="report-terms"></table>',
  ].join("\n");
}

function panelReportHtml() {
  return [
    '<div class="panel-tabs" id="panel-tabs">',
    '  <button class="panel-tab active" data-panel="claude">',
    '    <span class="panel-tab-name">Claude Opus 4.7</span>',
    '    <span class="panel-tab-state" data-tab-state="claude">Loading…</span>',
    "  </button>",
    '  <button class="panel-tab" data-panel="gpt">',
    '    <span class="panel-tab-name">GPT-5.5 Pro</span>',
    '    <span class="panel-tab-state" data-tab-state="gpt">Loading…</span>',
    "  </button>",
    '  <button class="panel-tab" data-panel="gemini">',
    '    <span class="panel-tab-name">Gemini 2.5 Pro</span>',
    '    <span class="panel-tab-state" data-tab-state="gemini">Loading…</span>',
    "  </button>",
    "</div>",
    '<div class="panel-pane" data-pane="claude">',
    '  <div class="panel-pane-loading">Claude is still drafting its review…</div>',
    '  <a class="btn primary panel-download" data-download="claude" hidden target="_blank" rel="noopener">',
    "    Download Claude's review (PDF)",
    "  </a>",
    '  <div class="panel-pane-content" hidden></div>',
    "</div>",
    '<div class="panel-pane" data-pane="gpt" hidden>',
    '  <div class="panel-pane-loading">GPT-5.5 Pro is still drafting its review…</div>',
    '  <a class="btn primary panel-download" data-download="gpt" hidden target="_blank" rel="noopener">',
    "    Download GPT's review (PDF)",
    "  </a>",
    '  <div class="panel-pane-content" hidden></div>',
    "</div>",
    '<div class="panel-pane" data-pane="gemini" hidden>',
    '  <div class="panel-pane-loading">Gemini 2.5 Pro is still drafting its review…</div>',
    '  <a class="btn primary panel-download" data-download="gemini" hidden target="_blank" rel="noopener">',
    "    Download Gemini's review (PDF)",
    "  </a>",
    '  <div class="panel-pane-content" hidden></div>',
    "</div>",
  ].join("\n");
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
    const dl = document.querySelector(".panel-download[data-download=\"" + k + "\"]");
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
    const stateEl = document.querySelector('[data-tab-state="' + k + '"]');
    if (!stateEl) return;
    const status = state.panelStatus[k];
    stateEl.className = "panel-tab-state " + status;
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

// ---- Polling ----
// /api/r/<code> is keyed on the recovery code, not session_id, so we can't
// reuse pollCheckoutStatus. Hand-roll the loop.
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
        if (state.tier === "single" && data.stage2?.result) {
          stopped = true;
          renderReportTab();
          return;
        }
        if (state.tier === "single" && data.stage2?.status === "error") {
          stopped = true;
          showLoaderError("single", friendlyDeepError(data.stage2.error));
          return;
        }
        if (state.tier === "panel") {
          const anyResult =
            data.panel?.claude?.result ||
            data.panel?.gpt?.result ||
            data.panel?.gemini?.result;
          if (anyResult) {
            renderReportTab();
          }
          const allDone = ["claude", "gpt", "gemini"].every((k) =>
            state.panelStatus[k] === "complete" || state.panelStatus[k] === "error"
          );
          if (allDone) { stopped = true; return; }
          const allError = ["claude", "gpt", "gemini"].every((k) =>
            state.panelStatus[k] === "error"
          );
          if (allError) {
            stopped = true;
            showLoaderError(
              "panel",
              "All three reviews failed to generate. Try again, or pay for a single report instead.",
            );
            return;
          }
        }
      }
    } catch (err) {
      console.warn("poll tick failed:", err);
    }
    setTimeout(tick, 2500);
  };
  tick();
  return () => { stopped = true; };
}

// ---- Lazy tab loaders (overlay + chat filled in by Phase 5 / Task 2.4) ----
async function loadOverlayTab() {
  if (state.overlayLoaded) return;
  state.overlayLoaded = true;
  const target = $("r-overlay-content");
  if (!state.paid || !state.downloadToken) {
    target.innerHTML = '<p class="rich-foot-note">Pay to unlock the visual overlay.</p>';
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
      '<p class="rich-foot-note error">Couldn\'t load overlay viewer: ' + (err.message || err) + "</p>";
  }
}

async function loadChatTab() {
  if (state.chatLoaded) return;
  state.chatLoaded = true;
  const target = $("r-chat-content");
  // The chat widget is the floating FAB at the bottom-right (injected by
  // initChat() at module load). The Chat tab is a friendly handoff that
  // opens that same panel — keeps a single source of truth for the
  // widget's DOM and history.
  target.innerHTML =
    '<div class="chat-placeholder" style="text-align:center;padding:60px 20px;color:var(--muted)">' +
    '<p style="margin-bottom:20px">Chat with the T-REX about TREC reviews, pricing, or how this report works.</p>' +
    '<button class="btn primary" id="r-chat-open">💬 Open chat</button>' +
    "</div>";
  const btn = $("r-chat-open");
  if (btn) {
    btn.onclick = () => {
      const fab = document.getElementById("chat-fab");
      const panel = document.getElementById("chat-panel");
      if (panel && !panel.classList.contains("open")) {
        if (fab) fab.click();
      }
    };
  }
}
