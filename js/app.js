// Main application controller.

import { uploadFile } from "/js/upload.js";
import { pollJobStatus } from "/js/poll.js";
import { openCheckout } from "/js/checkout.js";

const MAX_SIZE = 10 * 1024 * 1024;

const state = {
  jobId: null,
  paid: false,
  downloadToken: null,
  stage1: null,
  stage2: null,
  stage2Status: "pending",
  stopJobPoll: null,
};

function $(id) { return document.getElementById(id); }

function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

function showError(msg) {
  const el = $("drop-error");
  el.textContent = msg;
  el.hidden = false;
}
function clearError() { $("drop-error").hidden = true; }

document.addEventListener("DOMContentLoaded", () => {
  setupDropZone();
  checkRecoveryUrl();
});

function setupDropZone() {
  const zone = $("drop-zone");
  const input = $("file-input");

  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
    });
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

async function handleFile(file) {
  clearError();
  if (file.type !== "application/pdf") {
    showError("Please upload a PDF file.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showError("File is too large. Max 10 MB.");
    return;
  }

  hide("drop-section");
  show("upload-section");
  $("upload-status").textContent = `Uploading ${file.name}...`;

  try {
    const result = await uploadFile(file, (done, total) => {
      const pct = Math.round((done / total) * 100);
      $("upload-bar").style.width = pct + "%";
      $("upload-status").textContent =
        `Uploading: ${done}/${total} chunks (${pct}%)`;
    });
    state.jobId = result.job_id;
    hide("upload-section");
    show("scanning-section");
    startJobPolling();
  } catch (err) {
    hide("upload-section");
    show("drop-section");
    showError(`Upload failed: ${err.message}`);
  }
}

function startJobPolling() {
  state.stopJobPoll = pollJobStatus(
    state.jobId,
    (data) => {
      state.stage2Status = data.stage2?.status || "pending";

      if (data.stage1?.status === "complete" && !state.stage1) {
        state.stage1 = data.stage1.result;
        renderPreview(state.stage1);
        hide("scanning-section");
        show("preview-section");
      }

      if (data.stage1?.status === "error" && !state.stage1) {
        hide("scanning-section");
        show("drop-section");
        showError("Analysis failed. Please try re-uploading your contract.");
        if (state.stopJobPoll) state.stopJobPoll();
        return;
      }

      const s2 = data.stage2;
      if (s2?.status === "running" || s2?.status === "pending") {
        $("stage2-progress").hidden = false;
        $("unlock-btn").hidden = true;
      } else if (s2?.status === "complete") {
        $("stage2-progress").hidden = true;
        if (!state.paid) {
          $("unlock-btn").hidden = false;
        }
      } else if (s2?.status === "error") {
        $("stage2-progress").hidden = true;
        const errEl = $("stage2-error");
        errEl.textContent =
          "Full analysis could not be completed. Your quick summary is still available above.";
        errEl.hidden = false;
      }

      if (state.paid && s2?.status === "complete") {
        loadFullReport();
      }
    },
    (err) => {
      console.error(err);
      const errEl = $("stage2-error");
      errEl.textContent = err.message || "Polling failed.";
      errEl.hidden = false;
    },
  );
}

function renderPreview(s1) {
  $("preview-form").innerHTML =
    `<strong>${escapeHtml(s1.form_name || "Unknown form")}</strong>` +
    ` <span style="color:var(--muted)">— ${s1.confidence ?? "?"}% confidence</span>`;
  $("preview-mods").textContent =
    `${s1.modification_count ?? 0} modifications detected vs. standard form`;

  const flags = $("preview-flags");
  flags.innerHTML = "";
  (s1.red_flags || []).forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    flags.appendChild(li);
  });

  const terms = s1.terms || {};
  const tbl = $("preview-terms");
  tbl.innerHTML = "";
  const rows = [
    ["Price", terms.price],
    ["Option period", terms.option_period_days != null ? `${terms.option_period_days} days` : null],
    ["Closing date", terms.closing_date],
    ["Buyer", terms.buyer],
    ["Seller", terms.seller],
    ["Financing", terms.financing_type],
  ];
  rows.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(k)}</td><td>${escapeHtml(v ?? "—")}</td>`;
    tbl.appendChild(tr);
  });

  $("unlock-btn").onclick = () => {
    openCheckout(state.jobId, onPaid, (err) => {
      const errEl = $("card-error");
      if (errEl) {
        errEl.textContent = err.message || "Payment error";
        errEl.hidden = false;
      }
      console.error(err);
    });
  };
}

function onPaid(data) {
  state.paid = true;
  state.downloadToken = data.download_token;
  hide("preview-section");

  if (state.stage2Status === "complete") {
    loadFullReport();
  } else {
    show("paid-progress-section");
  }
}

async function loadFullReport() {
  if (!state.downloadToken) return;
  hide("paid-progress-section");
  try {
    const res = await fetch(
      `/api/report?id=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}`,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `report ${res.status}`);
    }
    const data = await res.json();
    state.stage2 = data.stage2?.result;
    renderFullReport(state.stage2);
    show("report-section");
    setupRecoveryUrl();
  } catch (err) {
    console.error("loadFullReport:", err);
    const errEl = $("stage2-error");
    errEl.textContent = `Failed to load full report: ${err.message}`;
    errEl.hidden = false;
  }
}

function renderFullReport(r) {
  if (!r) return;

  $("report-summary").textContent = r.summary || "";

  const modsEl = $("report-mods");
  modsEl.innerHTML = "";
  (r.modifications || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = "mod";
    const risk = (m.risk || "low").toLowerCase();
    div.innerHTML = `
      <div class="mod-header">
        <span class="risk-badge risk-${escapeAttr(risk)}">${escapeHtml(risk)}</span>
        <span class="mod-clause">${escapeHtml(m.clause || "")}</span>
      </div>
      <div class="mod-text-block">
        <span class="label">Standard form</span>
        ${escapeHtml(m.standard_text || "")}
      </div>
      <div class="mod-text-block">
        <span class="label">This contract</span>
        ${escapeHtml(m.contract_text || "")}
      </div>
      <p class="mod-explanation">${escapeHtml(m.explanation || "")}</p>
    `;
    if (m.questions && m.questions.length) {
      const q = document.createElement("div");
      q.className = "mod-questions";
      q.innerHTML = "<strong>Questions to ask:</strong>";
      const ul = document.createElement("ul");
      m.questions.forEach((qq) => {
        const li = document.createElement("li");
        li.textContent = qq;
        ul.appendChild(li);
      });
      q.appendChild(ul);
      div.appendChild(q);
    }
    modsEl.appendChild(div);
  });

  const tbl = $("report-terms");
  tbl.innerHTML = "";
  const terms = r.full_terms || {};
  Object.entries(terms).forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(k)}</td><td>${escapeHtml(v == null ? "—" : String(v))}</td>`;
    tbl.appendChild(tr);
  });

  $("download-pdf").href =
    `/api/report?id=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}&format=pdf`;
}

function setupRecoveryUrl() {
  const url = `${window.location.origin}/?job=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}`;
  $("recovery-url").textContent = url;
  $("recovery-note").hidden = false;
  history.replaceState({}, "", `/?job=${state.jobId}&token=${state.downloadToken}`);
}

async function checkRecoveryUrl() {
  const params = new URLSearchParams(window.location.search);
  const job = params.get("job");
  const token = params.get("token");
  if (!job || !token) return;

  try {
    const res = await fetch(
      `/api/report?id=${encodeURIComponent(job)}&token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) {
      console.warn("Recovery URL invalid");
      return;
    }
    const data = await res.json();
    if (!data.paid) {
      console.warn("Recovery URL not paid");
      return;
    }
    state.jobId = job;
    state.downloadToken = token;
    state.paid = true;
    state.stage1 = data.stage1?.result;
    state.stage2 = data.stage2?.result;
    state.stage2Status = data.stage2?.status;

    hide("drop-section");
    if (state.stage1) renderPreview(state.stage1);
    if (state.stage2) {
      renderFullReport(state.stage2);
      show("report-section");
    }
  } catch (err) {
    console.warn("recovery check failed:", err);
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/\s+/g, "-");
}
