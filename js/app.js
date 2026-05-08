import { uploadFile } from "/js/upload.js";
import { pollJobStatus } from "/js/poll.js";
import { openCheckout } from "/js/checkout.js";
import "/js/site.js";

const MAX_SIZE = 10 * 1024 * 1024;

const state = {
  jobId: null,
  pickedFile: null,
  paid: false,
  paidTier: null,
  downloadToken: null,
  stage1: null,
  stage2: null,
  stage1Status: "pending",
  stage2Status: "pending",
  panelStatus: { claude: "pending", gpt: "pending", gemini: "pending" },
  panelResults: { claude: null, gpt: null, gemini: null },
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
      setMascotRawr(true);
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    idle.addEventListener(ev, (e) => {
      e.preventDefault();
      idle.classList.remove("dragover");
      if (ev === "dragleave") setMascotRawr(false);
    });
  });
  idle.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFilePick(file);
  });
}

function setMascotRawr(on) {
  const mark = document.querySelector(".brand .mark");
  if (!mark) return;
  mark.classList.remove("rawring");
  if (on) {
    mark.classList.remove("rawr");
    void mark.offsetWidth;
    mark.classList.add("rawr");
  } else {
    mark.classList.remove("rawr");
  }
}

function setMascotRawring(on) {
  const mark = document.querySelector(".brand .mark");
  if (!mark) return;
  mark.classList.remove("rawr");
  if (on) {
    mark.classList.add("rawring");
  } else {
    mark.classList.remove("rawring");
  }
}

function flashMascotRawr(durationMs = 700) {
  setMascotRawr(true);
  setTimeout(() => {
    const mark = document.querySelector(".brand .mark");
    if (mark) mark.classList.remove("rawr");
  }, durationMs);
}

function setupButtons() {
  $("analyze-btn").addEventListener("click", () => {
    if (state.pickedFile) startAnalysis(state.pickedFile);
  });
  $("reset-file-btn").addEventListener("click", resetAll);
  $("reset-btn").addEventListener("click", resetAll);
  $("unlock-single-btn").addEventListener("click", () => {
    openCheckout(state.jobId, "single", onPaid, (err) => console.error(err));
  });
  $("unlock-panel-btn").addEventListener("click", () => {
    openCheckout(state.jobId, "panel", onPaid, (err) => console.error(err));
  });
  // Locked feature CTAs and the agent-cta strip both delegate to the
  // openCheckout flow with the tier baked into data-tier.
  document
    .querySelectorAll(".locked-cta, .agent-cta-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!state.jobId) return;
        const tier = btn.dataset.tier === "panel" ? "panel" : "single";
        openCheckout(state.jobId, tier, onPaid, (err) => console.error(err));
      });
    });

  document.querySelectorAll(".panel-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.panel;
      document.querySelectorAll(".panel-tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      document.querySelectorAll(".panel-pane").forEach((p) => {
        p.hidden = p.dataset.pane !== which;
      });
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
  flashMascotRawr();
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
  $("panel-report").hidden = true;
  $("recovery-note").hidden = true;
  $("panel-recovery-note").hidden = true;
  $("download-pdf").hidden = true;
  $("unlock-single-btn").hidden = false;
  $("unlock-panel-btn").hidden = false;
  $("stage2-running").hidden = true;
  $("stage2-error").hidden = true;
  document.querySelectorAll(".locked-row, .agent-cta").forEach((el) => {
    el.hidden = false;
  });
  state.panelStatus = { claude: "pending", gpt: "pending", gemini: "pending" };
  state.panelResults = { claude: null, gpt: null, gemini: null };
  setMascotRawring(false);
  history.replaceState({}, "", "/");
  setStage("idle");
}

async function startAnalysis(file) {
  $("analyzing-file-name").textContent = file.name;
  setStepState(0, "active");
  setProgress(5);
  setStage("analyzing");
  setMascotRawring(true);

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
  const pollStart = Date.now();
  let stage1RunningSince = null;
  const STAGE1_PENDING_TIMEOUT_MS = 90_000;
  const STAGE1_RUNNING_TIMEOUT_MS = 180_000;

  state.stopJobPoll = pollJobStatus(
    state.jobId,
    (data) => {
      const s1 = data.stage1?.status || "pending";
      const s2 = data.stage2?.status || "pending";
      state.stage1Status = s1;
      state.stage2Status = s2;
      state.panelStatus = {
        claude: data.panel?.claude?.status || "pending",
        gpt: data.panel?.gpt?.status || "pending",
        gemini: data.panel?.gemini?.status || "pending",
      };

      // Surface server-side state on the analyzing screen so the user
      // sees something is (or isn't) happening.
      const status = $("server-status");
      if (status) {
        if (s1 === "pending") status.textContent = `Job ${state.jobId} · waiting for scan to start…`;
        else if (s1 === "running") status.textContent = `Job ${state.jobId} · Haiku is reading the PDF…`;
        else if (s1 === "complete") status.textContent = `Job ${state.jobId} · scan complete`;
        else if (s1 === "error") status.textContent = `Job ${state.jobId} · ${data.stage1?.error || "scan failed"}`;
      }

      // Stuck-state timeouts — fire only while we're still waiting on stage1.
      if (!state.stage1) {
        if (s1 === "running" && !stage1RunningSince) stage1RunningSince = Date.now();
        const pendingFor = Date.now() - pollStart;
        const runningFor = stage1RunningSince ? Date.now() - stage1RunningSince : 0;
        if (s1 === "pending" && pendingFor > STAGE1_PENDING_TIMEOUT_MS) {
          if (state.stopJobPoll) state.stopJobPoll();
          setStage("idle");
          setMascotRawring(false);
          showError(
            `Quick scan never started. Job ${state.jobId}. ` +
              `Likely the background function failed to fire — check Netlify function logs.`,
          );
          return;
        }
        if (s1 === "running" && runningFor > STAGE1_RUNNING_TIMEOUT_MS) {
          if (state.stopJobPoll) state.stopJobPoll();
          setStage("idle");
          setMascotRawring(false);
          showError(
            `Quick scan stuck mid-run. Job ${state.jobId}. ` +
              `PDF parse or AI call may have hung — check Netlify function logs.`,
          );
          return;
        }
      }

      if (s1 === "running") {
        setStepState(1, "active");
        if (currentProgress() < 45) setProgress(45);
      }
      if (s1 === "complete") {
        setStepState(1, "done");
        if (!state.stage1) {
          state.stage1 = data.stage1.result;
          setStepState(2, "done");
          setStepState(3, "done");
          setProgress(100);
          renderFreePreview(state.stage1);
          setStage("results");
          setMascotRawring(false);

          if (!state.paid) {
            $("unlock-single-btn").hidden = false;
            $("unlock-panel-btn").hidden = false;
          }
        }
      }
      if (s1 === "error" && !state.stage1) {
        setStage("idle");
        setMascotRawring(false);
        const errMsg = data.stage1?.error
          ? `Analysis failed: ${data.stage1.error} (Job ${state.jobId})`
          : `Analysis failed (Job ${state.jobId}). Please try re-uploading your contract.`;
        showError(errMsg);
        if (state.stopJobPoll) state.stopJobPoll();
        return;
      }

      if (state.paid && state.paidTier === "single") {
        if (s2 === "complete" && !state.stage2) {
          loadFullReport();
        }
        if (s2 === "error") {
          $("stage2-running").hidden = true;
          const errEl = $("stage2-error");
          errEl.textContent =
            "Deep analysis could not be completed. Refresh to retry, or contact support.";
          errEl.hidden = false;
        }
      }

      if (state.paid && state.paidTier === "panel") {
        updatePanelTabStates();
        const allDone = ["claude", "gpt", "gemini"].every(
          (k) =>
            state.panelStatus[k] === "complete" ||
            state.panelStatus[k] === "error",
        );
        if (
          state.panelStatus.claude === "complete" ||
          state.panelStatus.gpt === "complete" ||
          state.panelStatus.gemini === "complete"
        ) {
          loadPanelReport();
        }
        if (allDone && state.stopJobPoll) {
          state.stopJobPoll();
        }
      }
    },
    (err) => {
      console.error(err);
      // If we never got stage1 results, surface the error in the drop
      // section instead of leaving the user staring at a stalled
      // progress bar.
      if (!state.stage1) {
        setStage("idle");
        setMascotRawring(false);
        showError(err.message || "Polling failed. Please try again.");
        return;
      }
      const errEl = $("stage2-error");
      errEl.textContent = err.message || "Polling failed.";
      errEl.hidden = false;
    },
  );
}

function updatePanelTabStates() {
  ["claude", "gpt", "gemini"].forEach((k) => {
    const stateEl = document.querySelector(`[data-tab-state="${k}"]`);
    if (!stateEl) return;
    const status = state.panelStatus[k];
    stateEl.className = `panel-tab-state ${status}`;
    stateEl.textContent =
      status === "complete"
        ? "Done"
        : status === "running"
          ? "Reviewing…"
          : status === "error"
            ? "Failed"
            : "Queued";
  });
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

const TERM_ORDER = [
  ["sales_price", "Sales Price"],
  ["earnest_money", "Earnest Money"],
  ["option_fee_period", "Option Fee / Period"],
  ["title_notice_period", "Title Notice Period"],
  ["closing_date", "Closing Date"],
  ["financing", "Financing"],
  ["survey", "Survey"],
  ["special_provisions", "Special Provisions"],
];

function renderFreePreview(s1) {
  // doc title + sub
  const address = s1?.property_address;
  const file = state.pickedFile;
  const titleEl = $("results-doc-title");
  const subEl = $("results-doc-sub");
  if (titleEl) {
    if (address) {
      titleEl.textContent = address;
      titleEl.classList.remove("muted");
    } else if (file?.name) {
      titleEl.textContent = file.name;
      titleEl.classList.remove("muted");
    } else {
      titleEl.textContent = "Property address not detected";
      titleEl.classList.add("muted");
    }
  }
  if (subEl) {
    const formId = s1?.form_id;
    const formName = s1?.form_name;
    const pages = s1?.page_count
      ? `${s1.page_count} page${s1.page_count === 1 ? "" : "s"}`
      : null;
    const parts = [];
    if (formId && formId !== "unknown") parts.push(`TREC ${formId}`);
    if (formName && formName !== "Unknown form") parts.push(formName);
    if (pages) parts.push(pages);
    if (parts.length === 0 && file?.name) parts.push(file.name);
    if (parts.length === 0) parts.push("Form not identified");
    subEl.textContent = parts.join(" · ");
  }

  // badges
  const badges = $("results-badges");
  if (badges) {
    badges.innerHTML = "";
    const high = s1?.severity_high ?? 0;
    const medium = s1?.severity_medium ?? 0;
    if (high + medium > 0) {
      const sevParts = [];
      if (high) sevParts.push(`${high} high`);
      if (medium) sevParts.push(`${medium} medium`);
      badges.insertAdjacentHTML(
        "beforeend",
        `<span class="badge warn"><span class="pip"></span>${escapeHtml(sevParts.join(" · "))}</span>`,
      );
    }
    const status = s1?.status || "reviewable";
    const statusLabel =
      status === "reviewable"
        ? "Reviewable"
        : status === "needs_attention"
          ? "Needs attention"
          : "Hard to read";
    const statusClass = status === "reviewable" ? "ok" : "warn";
    badges.insertAdjacentHTML(
      "beforeend",
      `<span class="badge ${statusClass}"><span class="pip"></span>${escapeHtml(statusLabel)}</span>`,
    );
  }

  // 4×2 terms grid
  const grid = $("terms-grid");
  if (grid) {
    grid.innerHTML = "";
    const terms = s1?.terms || {};
    for (const [key, label] of TERM_ORDER) {
      const t = terms[key];
      grid.appendChild(renderTermCell(label, t));
    }
  }
}

function renderTermCell(label, term) {
  const cell = document.createElement("div");
  cell.className = "term";

  const labelEl = document.createElement("div");
  labelEl.className = "term-label";
  labelEl.textContent = label;
  cell.appendChild(labelEl);

  const value = term?.value;
  const note = term?.note;
  const warning = term?.warning;
  const isEmpty = !value || String(value).trim() === "";

  const valueEl = document.createElement("div");
  if (!isEmpty) {
    valueEl.className = "term-value";
    valueEl.textContent = value;
  } else {
    cell.classList.add("term-empty");
    valueEl.className = "term-value empty";
    // If the AI flagged the empty field with a warning, the warning IS
    // the headline. Otherwise show a neutral 'not filled' caption.
    valueEl.textContent = warning ? "Blank" : "Not filled";
  }
  cell.appendChild(valueEl);

  if (note) {
    const noteEl = document.createElement("div");
    noteEl.className = "term-note";
    noteEl.textContent = note;
    cell.appendChild(noteEl);
  } else if (isEmpty && !warning) {
    // Subtle hint that this isn't a critical issue, just unfilled.
    const noteEl = document.createElement("div");
    noteEl.className = "term-note";
    noteEl.textContent = "Not detected in this scan";
    cell.appendChild(noteEl);
  }

  if (warning) {
    const warnEl = document.createElement("div");
    warnEl.className = "term-warning";
    warnEl.innerHTML = `<span class="ic" aria-hidden="true">!</span><span>${escapeHtml(warning)}</span>`;
    cell.appendChild(warnEl);
  }

  return cell;
}

function onPaid(data) {
  state.paid = true;
  state.paidTier = data.tier || "single";
  state.downloadToken = data.download_token;
  $("unlock-single-btn").hidden = true;
  $("unlock-panel-btn").hidden = true;
  document.querySelectorAll(".locked-row, .agent-cta").forEach((el) => {
    el.hidden = true;
  });

  if (state.paidTier === "panel") {
    $("panel-report").hidden = false;
    updatePanelTabStates();
    if (!state.stopJobPoll) startJobPolling();
  } else {
    if (state.stage2Status === "complete") {
      loadFullReport();
    } else {
      $("stage2-running").hidden = false;
      $("stage2-running").textContent =
        "Payment confirmed. Full report is still being generated…";
      if (!state.stopJobPoll) startJobPolling();
    }
  }
}

async function loadPanelReport() {
  if (!state.downloadToken || !state.jobId) return;
  try {
    const res = await fetch(
      `/api/report?id=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (!data.panel) return;

    ["claude", "gpt", "gemini"].forEach((k) => {
      const result = data.panel[k]?.result;
      const status = data.panel[k]?.status;
      state.panelStatus[k] = status;
      if (result && !state.panelResults[k]) {
        state.panelResults[k] = result;
        renderPanelPane(k, result);
      }
    });
    updatePanelTabStates();

    const allDone = ["claude", "gpt", "gemini"].every(
      (k) =>
        state.panelStatus[k] === "complete" ||
        state.panelStatus[k] === "error",
    );
    if (allDone) {
      setupPanelRecoveryUrl();
      if (state.stopJobPoll) state.stopJobPoll();
    }
  } catch (err) {
    console.error("loadPanelReport:", err);
  }
}

function renderPanelPane(which, result) {
  const pane = document.querySelector(`.panel-pane[data-pane="${which}"]`);
  if (!pane) return;
  const loading = pane.querySelector(".panel-pane-loading");
  const content = pane.querySelector(".panel-pane-content");
  if (loading) loading.hidden = true;
  if (!content) return;
  content.innerHTML = renderReportHtml(result);
  content.hidden = false;
}

function renderReportHtml(r) {
  if (!r) return "";
  const summary = escapeHtml(r.summary || "");
  const mods = (r.modifications || [])
    .map((m) => {
      const risk = (m.risk || "low").toLowerCase();
      const escClause = escapeHtml(m.clause || "");
      const escStd = escapeHtml(m.standard_text || "");
      const escContract = escapeHtml(m.contract_text || "");
      const escExplain = escapeHtml(m.explanation || "");
      const questions = (m.questions || []).length
        ? `<div class="mod-questions"><strong>Questions to ask:</strong><ul>${(m.questions || [])
            .map((q) => `<li>${escapeHtml(q)}</li>`)
            .join("")}</ul></div>`
        : "";
      return `
        <div class="mod">
          <div class="mod-header">
            <span class="risk-badge risk-${escapeAttr(risk)}">${escapeHtml(risk)}</span>
            <span class="mod-clause">${escClause}</span>
          </div>
          <div class="mod-text-block"><span class="label">Standard form</span>${escStd}</div>
          <div class="mod-text-block"><span class="label">This contract</span>${escContract}</div>
          <p class="summary">${escExplain}</p>
          ${questions}
        </div>`;
    })
    .join("");
  const terms = Object.entries(r.full_terms || {})
    .map(
      ([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v == null ? "—" : String(v))}</td></tr>`,
    )
    .join("");
  return `
    <h3>Summary</h3>
    <p>${summary}</p>
    <h3>Modifications</h3>
    ${mods || '<p style="color:var(--muted);font-size:14px">No modifications detected.</p>'}
    <h3>Full Terms</h3>
    <table>${terms}</table>
  `;
}

function setupPanelRecoveryUrl() {
  const url = `${window.location.origin}/?job=${encodeURIComponent(state.jobId)}&token=${encodeURIComponent(state.downloadToken)}`;
  $("panel-recovery-url").textContent = url;
  $("panel-recovery-note").hidden = false;
  history.replaceState({}, "", `/?job=${state.jobId}&token=${state.downloadToken}`);
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
    state.paidTier = data.tier || "single";
    state.stage1 = data.stage1?.result;
    state.stage1Status = data.stage1?.status;
    state.stage2Status = data.stage2?.status;

    if (state.stage1) {
      renderFreePreview(state.stage1);
      setStage("results");
      $("unlock-single-btn").hidden = true;
      $("unlock-panel-btn").hidden = true;
    }

    if (state.paidTier === "panel" && data.panel) {
      $("panel-report").hidden = false;
      ["claude", "gpt", "gemini"].forEach((k) => {
        const result = data.panel[k]?.result;
        const status = data.panel[k]?.status;
        state.panelStatus[k] = status;
        if (result) {
          state.panelResults[k] = result;
          renderPanelPane(k, result);
        }
      });
      updatePanelTabStates();
      setupPanelRecoveryUrl();
    } else if (state.paidTier === "single") {
      state.stage2 = data.stage2?.result;
      if (state.stage2) {
        renderFullReport(state.stage2);
        $("full-report").hidden = false;
        $("download-pdf").hidden = false;
        $("download-pdf").href =
          `/api/report?id=${encodeURIComponent(job)}&token=${encodeURIComponent(token)}&format=pdf`;
        setupRecoveryUrl();
      }
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
