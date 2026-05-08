import { uploadFile } from "/js/upload.js";
import { pollJobStatus } from "/js/poll.js";
import { openCheckout } from "/js/checkout.js";

const MAX_SIZE = 10 * 1024 * 1024;

const state = {
  jobId: null,
  pickedFile: null,
  paid: false,
  downloadToken: null,
  stage1: null,
  stage2: null,
  stage1Status: "pending",
  stage2Status: "pending",
  stopJobPoll: null,
};

const $ = (id) => document.getElementById(id);

const STAGES = ["idle", "file", "analyzing", "results"];

function setStage(name) {
  STAGES.forEach((s) => {
    const el = $(`drop-${s}`);
    if (el) el.hidden = s !== name;
  });
}

function showError(msg) {
  const el = $("drop-error");
  el.textContent = msg;
  el.hidden = false;
}
function clearError() { $("drop-error").hidden = true; }

document.addEventListener("DOMContentLoaded", () => {
  setupDropZone();
  setupButtons();
  checkRecoveryUrl();
});

function setupDropZone() {
  const idle = $("drop-idle");
  const input = $("file-input");

  idle.addEventListener("click", (e) => {
    if (e.target === input) return;
    input.click();
  });
  input.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleFilePick(file);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    idle.addEventListener(ev, (e) => {
      e.preventDefault();
      idle.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    idle.addEventListener(ev, (e) => {
      e.preventDefault();
      idle.classList.remove("dragover");
    });
  });
  idle.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFilePick(file);
  });
}

function setupButtons() {
  $("analyze-btn").addEventListener("click", () => {
    if (state.pickedFile) startAnalysis(state.pickedFile);
  });
  $("reset-file-btn").addEventListener("click", resetAll);
  $("reset-btn").addEventListener("click", resetAll);
  $("unlock-btn").addEventListener("click", () => {
    openCheckout(state.jobId, onPaid, (err) => {
      console.error(err);
    });
  });
}

function handleFilePick(file) {
  clearError();
  if (file.type !== "application/pdf") {
    showError("Please upload a PDF file.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showError("File is too large. Max 10 MB.");
    return;
  }
  state.pickedFile = file;
  $("file-name").textContent = file.name;
  $("file-stats").textContent = `${formatSize(file.size)} · ready to review`;
  setStage("file");
}

function resetAll() {
  if (state.stopJobPoll) state.stopJobPoll();
  Object.assign(state, {
    jobId: null,
    pickedFile: null,
    paid: false,
    downloadToken: null,
    stage1: null,
    stage2: null,
    stage1Status: "pending",
    stage2Status: "pending",
    stopJobPoll: null,
  });
  $("file-input").value = "";
  $("full-report").hidden = true;
  $("recovery-note").hidden = true;
  $("download-pdf").hidden = true;
  $("unlock-btn").hidden = true;
  $("stage2-running").hidden = true;
  $("stage2-error").hidden = true;
  history.replaceState({}, "", "/");
  setStage("idle");
}

async function startAnalysis(file) {
  $("analyzing-file-name").textContent = file.name;
  setStepState(0, "active");
  setProgress(5);
  setStage("analyzing");

  try {
    const result = await uploadFile(file, (done, total) => {
      const pct = 5 + Math.round((done / total) * 20);
      setProgress(pct);
    });
    state.jobId = result.job_id;
    setStepState(0, "done");
    setStepState(1, "active");
    setProgress(28);
    startJobPolling();
  } catch (err) {
    setStage("idle");
    showError(`Upload failed: ${err.message}`);
  }
}

function startJobPolling() {
  state.stopJobPoll = pollJobStatus(
    state.jobId,
    (data) => {
      const s1 = data.stage1?.status || "pending";
      const s2 = data.stage2?.status || "pending";
      state.stage1Status = s1;
      state.stage2Status = s2;

      // step 2: stage1 quick scan
      if (s1 === "running") {
        setStepState(1, "active");
        if (currentProgress() < 45) setProgress(45);
      }
      if (s1 === "complete") {
        setStepState(1, "done");
        if (!state.stage1) {
          state.stage1 = data.stage1.result;
          setStepState(2, "active");
          if (currentProgress() < 60) setProgress(60);
          // once stage1 is done, transition to results showing free preview
          renderFreePreview(state.stage1);
          setStage("results");
        }
      }
      if (s1 === "error" && !state.stage1) {
        setStage("idle");
        showError("Analysis failed. Please try re-uploading your contract.");
        if (state.stopJobPoll) state.stopJobPoll();
        return;
      }

      // step 3+4: stage2 deep scan
      if (s2 === "running") {
        setStepState(2, "active");
        if (currentProgress() < 75) setProgress(75);
        $("stage2-running").hidden = false;
      }
      if (s2 === "complete") {
        setStepState(2, "done");
        setStepState(3, "done");
        setProgress(100);
        $("stage2-running").hidden = true;
        if (!state.paid) {
          $("unlock-btn").hidden = false;
        } else {
          loadFullReport();
        }
      }
      if (s2 === "error") {
        $("stage2-running").hidden = true;
        const errEl = $("stage2-error");
        errEl.textContent =
          "Full analysis could not be completed. Your quick summary is still available.";
        errEl.hidden = false;
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

function setStepState(idx, status) {
  document.querySelectorAll("#steps .step").forEach((el) => {
    const i = Number(el.dataset.step);
    if (i < idx) {
      el.classList.add("done");
      el.classList.remove("active");
      el.querySelector(".tick").innerHTML = checkSvg();
    } else if (i === idx) {
      el.classList.remove("done");
      if (status === "done") {
        el.classList.add("done");
        el.classList.remove("active");
        el.querySelector(".tick").innerHTML = checkSvg();
      } else {
        el.classList.add("active");
        el.querySelector(".tick").innerHTML = "";
      }
    } else {
      el.classList.remove("active", "done");
      el.querySelector(".tick").innerHTML = "";
    }
  });
}

function setProgress(pct) {
  $("progress-fill").style.width = pct + "%";
  $("progress-pct").textContent = Math.round(pct) + "%";
}
function currentProgress() {
  const w = $("progress-fill").style.width || "0%";
  return parseFloat(w) || 0;
}

function checkSvg() {
  return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-11"/></svg>';
}

function renderFreePreview(s1) {
  const file = state.pickedFile;
  if (file) {
    $("results-file-name").textContent = file.name;
    $("results-file-stats").textContent =
      `${formatSize(file.size)} · ${s1?.form_id || "TREC"} · reviewed just now`;
  } else {
    $("results-file-name").textContent =
      `${s1?.form_id || "TREC"} contract`;
    $("results-file-stats").textContent = `${s1?.form_name || ""}`;
  }

  const flagCount = s1?.red_flags?.length || 0;
  const modCount = s1?.modification_count ?? 0;
  const badges = $("results-badges");
  badges.innerHTML = "";
  if (flagCount > 0) {
    badges.innerHTML += `<span class="badge warn"><span class="pip"></span>${flagCount} flagged</span>`;
  }
  badges.innerHTML += `<span class="badge ok"><span class="pip"></span>${modCount} modifications</span>`;

  const formName = s1?.form_name || "Unknown form";
  const conf = s1?.confidence ?? "?";
  $("result-form").innerHTML =
    `Detected as <b>${escapeHtml(formName)}</b> (${escapeHtml(String(conf))}% confidence). ` +
    `Trex compared this contract against the published TREC standard form and found ` +
    `<b>${modCount} modifications</b>.`;

  if (flagCount > 0) {
    $("result-mods").innerHTML =
      `${flagCount} ${flagCount === 1 ? "issue" : "issues"} worth a closer ` +
      `look — listed on the right. Unlock the full report to see the standard form text, ` +
      `risk ratings, and suggested questions.`;
  } else {
    $("result-mods").innerHTML =
      `No major red flags surfaced in the quick scan. Unlock the full report ` +
      `for a clause-by-clause breakdown.`;
  }

  const t = s1?.terms || {};
  const parts = [];
  if (t.price) parts.push(`Price: <b>${escapeHtml(t.price)}</b>`);
  if (t.option_period_days != null)
    parts.push(`Option period: <b>${escapeHtml(String(t.option_period_days))} days</b>`);
  if (t.closing_date) parts.push(`Closing: <b>${escapeHtml(t.closing_date)}</b>`);
  if (t.financing_type) parts.push(`Financing: <b>${escapeHtml(t.financing_type)}</b>`);
  if (t.buyer) parts.push(`Buyer: <b>${escapeHtml(t.buyer)}</b>`);
  if (t.seller) parts.push(`Seller: <b>${escapeHtml(t.seller)}</b>`);
  $("result-terms").innerHTML = parts.length
    ? parts.join(" &nbsp;·&nbsp; ")
    : '<span style="color:var(--muted)">No basic terms extracted.</span>';

  const issuesEl = $("issues");
  issuesEl.innerHTML = "";
  $("issue-count").textContent = flagCount ? `(${flagCount})` : "";
  const flags = s1?.red_flags || [];
  if (flags.length === 0) {
    issuesEl.innerHTML =
      '<p class="summary" style="color:var(--muted);font-size:13px;margin:0">No red flags surfaced.</p>';
  } else {
    flags.forEach((flag, i) => {
      const sev = i === 0 ? "high" : i === 1 ? "med" : "low";
      const el = document.createElement("div");
      el.className = `issue ${sev}`;
      el.innerHTML = `
        <div class="sev"></div>
        <div class="issue-body">
          <div class="issue-top">
            <p class="issue-title">${escapeHtml(flag)}</p>
            <span class="issue-loc">${sev.toUpperCase()}</span>
          </div>
          <p class="issue-desc">Unlock the full report for the standard form text, plain-English explanation, and suggested questions to ask.</p>
        </div>`;
      issuesEl.appendChild(el);
    });
  }
}

function onPaid(data) {
  state.paid = true;
  state.downloadToken = data.download_token;
  $("unlock-btn").hidden = true;

  if (state.stage2Status === "complete") {
    loadFullReport();
  } else {
    $("stage2-running").hidden = false;
    $("stage2-running").textContent =
      "Payment confirmed. Full report is still being generated…";
  }
}

async function loadFullReport() {
  if (!state.downloadToken || !state.jobId) return;
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
    if (state.stage2) {
      renderFullReport(state.stage2);
      $("full-report").hidden = false;
      $("download-pdf").hidden = false;
      $("download-pdf").href =
        `/api/report?id=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}&format=pdf`;
      setupRecoveryUrl();
      $("stage2-running").hidden = true;
    }
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
    const escClause = escapeHtml(m.clause || "");
    const escStd = escapeHtml(m.standard_text || "");
    const escContract = escapeHtml(m.contract_text || "");
    const escExplain = escapeHtml(m.explanation || "");
    div.innerHTML = `
      <div class="mod-header">
        <span class="risk-badge risk-${escapeAttr(risk)}">${escapeHtml(risk)}</span>
        <span class="mod-clause">${escClause}</span>
      </div>
      <div class="mod-text-block">
        <span class="label">Standard form</span>
        ${escStd}
      </div>
      <div class="mod-text-block">
        <span class="label">This contract</span>
        ${escContract}
      </div>
      <p class="summary">${escExplain}</p>
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
  Object.entries(r.full_terms || {}).forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(k)}</td><td>${escapeHtml(v == null ? "—" : String(v))}</td>`;
    tbl.appendChild(tr);
  });
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
    if (!res.ok) return;
    const data = await res.json();
    if (!data.paid) return;

    state.jobId = job;
    state.downloadToken = token;
    state.paid = true;
    state.stage1 = data.stage1?.result;
    state.stage2 = data.stage2?.result;
    state.stage1Status = data.stage1?.status;
    state.stage2Status = data.stage2?.status;

    if (state.stage1) {
      renderFreePreview(state.stage1);
      setStage("results");
      $("unlock-btn").hidden = true;
    }
    if (state.stage2) {
      renderFullReport(state.stage2);
      $("full-report").hidden = false;
      $("download-pdf").hidden = false;
      $("download-pdf").href =
        `/api/report?id=${encodeURIComponent(job)}&token=${encodeURIComponent(token)}&format=pdf`;
      setupRecoveryUrl();
    }
  } catch (err) {
    console.warn("recovery check failed:", err);
  }
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
