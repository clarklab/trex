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

// The floating chat FAB is mounted lazily once the dashboard data
// resolves — see init() / pollResolveLoop() below. We delay the call so
// we can pass `jobContext` (real numbers from this contract) to the
// chat widget; without it the AI has no idea what report it's
// answering questions about.

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
  if (state.paid) {
    initChat({ delayMs: 0, jobContext: buildJobContext(data) });
  }
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
        // Refresh chat's job context so the AI sees newly arrived
        // stage2 / panel-model results.
        if (state.paid) {
          initChat({ delayMs: 0, jobContext: buildJobContext(data) });
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
  // Render every time it's clicked (no `chatLoaded` guard) — cheap, and
  // keeps the open-chat button responsive even if it was rebuilt.
  const target = $("r-chat-content");
  target.innerHTML =
    '<div class="chat-placeholder" style="text-align:center;padding:60px 20px;color:var(--muted)">' +
    '<p style="font-size:15px;margin-bottom:20px">' +
    "Chat with the T-REX about this specific contract. " +
    "I have the numbers, the modifications, and the analysis loaded — ask anything." +
    "</p>" +
    '<button class="btn primary" id="r-chat-open">💬 Open chat</button>' +
    "</div>";
  const btn = $("r-chat-open");
  if (btn) {
    btn.onclick = () => {
      const fab = document.getElementById("chat-fab");
      const panel = document.getElementById("chat-panel");
      if (panel && !panel.classList.contains("open") && fab) {
        fab.click();
      }
    };
  }
}

// ---- Per-job context for the chat widget ----
// Builds a plain-text summary of everything we know about this contract
// so the AI can answer specific questions ("what's my sales price?",
// "what did Claude flag?"). Defensive — every field is optional so we
// can call this on stage1-only data and again as stage2 / panel
// results trickle in via polling. The backend caps total length at
// 6000 chars; we still cap individual fields here to keep relevant
// info from being chopped.
function buildJobContext(data) {
  if (!data) return "";
  const parts = [];
  const stage1 = data.stage1?.result || {};
  const tier = data.tier === "panel" ? "Panel review (3 models)"
    : data.tier === "single" ? "Single review"
      : "Free quick scan";
  const paidLine = data.paid_at
    ? "Paid " + new Date(data.paid_at).toLocaleDateString()
    : "Not yet paid";

  // --- Header / form facts ---
  const facts = [];
  if (stage1.form_id) {
    facts.push(
      "Form: TREC " + stage1.form_id +
      (stage1.form_name ? " (" + stage1.form_name + ")" : "") +
      (stage1.page_count ? ", " + stage1.page_count + " pages" : "") +
      (typeof stage1.confidence === "number" ? ", confidence " + stage1.confidence + "%" : ""),
    );
  }
  if (stage1.status) facts.push("Status: " + stage1.status);
  const sevBits = [];
  if (typeof stage1.severity_high === "number") sevBits.push(stage1.severity_high + " high");
  if (typeof stage1.severity_medium === "number") sevBits.push(stage1.severity_medium + " medium");
  if (sevBits.length) facts.push("Severity: " + sevBits.join(" · "));
  facts.push("Tier: " + tier + " (" + paidLine + ")");

  // Property city/state/zip only — never the street address. Many
  // contract addresses are typed as one line ("1428 Magnolia Ave,
  // Austin TX 78704"); pull just the trailing city + state-and-ZIP
  // chunk via regex so we don't leak the street.
  const addr = typeof stage1.property_address === "string" ? stage1.property_address : "";
  if (addr) {
    // Match "<City>, <ST> <ZIP>" or "<City> <ST> <ZIP>" at end of string.
    const m = addr.match(/([A-Za-z .'-]{2,40}),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/);
    if (m) {
      facts.push("Property: " + m[1].trim() + ", " + m[2] + " " + m[3]);
    }
  }
  if (facts.length) {
    parts.push("## REPORT FACTS\n" + facts.join("\n"));
  }

  // --- Quick-scan terms ---
  const terms = stage1.terms && typeof stage1.terms === "object" ? stage1.terms : null;
  if (terms) {
    const lines = [];
    for (const [key, t] of Object.entries(terms)) {
      if (!t || typeof t !== "object") continue;
      const v = (t.value ?? "").toString().slice(0, 80);
      const note = (t.note ?? "").toString().slice(0, 120);
      const warn = (t.warning ?? "").toString().slice(0, 160);
      const label = key.replace(/_/g, " ");
      let line = "- " + label + ": " + (v || "(blank)");
      if (note) line += " — " + note;
      if (warn) line += "  [WARN: " + warn + "]";
      lines.push(line);
    }
    if (lines.length) parts.push("## TERMS\n" + lines.join("\n"));
  }

  // --- Quick-scan red flags ---
  const flags = Array.isArray(stage1.red_flags) ? stage1.red_flags : [];
  if (flags.length) {
    const lines = flags
      .filter((f) => f && typeof f === "object")
      .map((f) => {
        const sev = (f.severity || "").toString();
        const title = (f.title || "").toString().slice(0, 160);
        return "- [" + sev + "] " + title;
      });
    if (lines.length) parts.push("## RED FLAGS\n" + lines.join("\n"));
  }

  // --- Single-tier deep scan ---
  if (data.tier === "single") {
    const s2 = data.stage2?.result;
    if (s2) {
      if (typeof s2.summary === "string" && s2.summary.trim()) {
        parts.push("## DEEP-SCAN SUMMARY\n" + s2.summary.trim().slice(0, 1500));
      }
      const mods = Array.isArray(s2.modifications) ? s2.modifications : [];
      if (mods.length) {
        const lines = mods.map((m) => {
          const risk = (m?.risk || "").toString();
          const clause = (m?.clause || "").toString().slice(0, 80);
          const expl = (m?.explanation || "").toString().slice(0, 200);
          return "- [" + risk + "] " + clause + " — " + expl;
        });
        parts.push("## MODIFICATIONS\n" + lines.join("\n"));
      }
      const ft = s2.full_terms && typeof s2.full_terms === "object" ? s2.full_terms : null;
      if (ft) {
        const lines = Object.entries(ft).map(([k, v]) => {
          const val = v == null ? "—" : String(v).slice(0, 120);
          return "- " + k.replace(/_/g, " ") + ": " + val;
        });
        if (lines.length) parts.push("## FULL TERMS\n" + lines.join("\n"));
      }
    } else if (data.stage2?.status) {
      parts.push("## DEEP-SCAN STATUS\n" + data.stage2.status);
    }
  }

  // --- Panel tier ---
  if (data.tier === "panel" && data.panel) {
    const labels = {
      claude: "Claude Opus 4.7",
      gpt: "GPT-5.5 Pro",
      gemini: "Gemini 2.5 Pro",
    };
    const lines = [];
    for (const k of ["claude", "gpt", "gemini"]) {
      const slot = data.panel[k];
      if (!slot) continue;
      const status = slot.status || "pending";
      const result = slot.result;
      if (result && typeof result.summary === "string" && result.summary.trim()) {
        lines.push("### " + labels[k] + " (" + status + ")");
        lines.push(result.summary.trim().slice(0, 600));
        const mods = Array.isArray(result.modifications) ? result.modifications : [];
        if (mods.length) {
          const top = mods.slice(0, 5).map((m) => {
            const risk = (m?.risk || "").toString();
            const clause = (m?.clause || "").toString().slice(0, 60);
            return "  - [" + risk + "] " + clause;
          });
          lines.push(top.join("\n"));
        }
      } else {
        lines.push("### " + labels[k] + " — " + (status === "complete" ? "complete (no result)" : "still drafting"));
      }
    }
    if (lines.length) parts.push("## PANEL RESULTS\n" + lines.join("\n"));
  }

  return parts.join("\n\n");
}
