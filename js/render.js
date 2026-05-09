// js/render.js — shared rendering helpers used by the upload page (app.js)
// and the standalone dashboard (r.js, added in a later task).

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/\s+/g, "-");
}

export function friendlyDeepError(rawError) {
  const e = String(rawError || "").toLowerCase();
  if (e.includes("expected") && e.includes("json")) {
    return "The model returned an unparseable response. This usually means it ran long and got cut off — refreshing usually fixes it.";
  }
  if (e.includes("timeout") || e.includes("timed out")) {
    return "The analysis took too long and timed out. Refresh to retry — large contracts sometimes need a second pass.";
  }
  if (e.includes("rate") && e.includes("limit")) {
    return "The AI provider is rate-limiting us right now. Wait a minute and refresh.";
  }
  if (e.includes("api key") || e.includes("authentication")) {
    return "We had a credentials problem on our end. Contact support and include the job ID from the URL.";
  }
  return "Something went wrong while generating your report. Refreshing usually fixes it.";
}

// generating-loader controller — module-private state.
const REX_POSES = [
  "/assets/rex.png",
  "/assets/rex-concern.png",
  "/assets/rex-cheer.png",
];
const SINGLE_LOADER_MESSAGES = [
  "Reading every paragraph carefully…",
  "Cross-checking against the standard form…",
  "Looking for red flags…",
  "Doing the sales-price math…",
  "Decoding any legal jargon…",
  "Drafting your summary…",
  "Polishing the report…",
  "Almost there…",
];
const PANEL_LOADER_MESSAGES = [
  "Three frontier AIs are reading your contract…",
  "Each model is drafting its review independently…",
  "Watching where they agree and disagree…",
  "Nothing makes a contract clearer than three opinions on it.",
  "Polishing the panel report…",
  "Almost there…",
];
const loaderTimers = { msg: null, hero: null, trio: null };

export function showGeneratingLoader(tier) {
  const loader = document.getElementById("generating-loader");
  if (!loader) return;
  const card = loader.querySelector(".generating-card");
  const single = loader.querySelector('.rex-stage[data-mode="single"]');
  const panel = loader.querySelector('.rex-stage[data-mode="panel"]');
  const headline = document.getElementById("generating-headline");
  const meta = document.getElementById("generating-meta");
  const actions = document.getElementById("generating-actions");

  if (card) card.classList.remove("is-error");
  if (actions) actions.hidden = true;
  if (meta) {
    meta.textContent = "This usually takes 20–60 seconds. Don't close this tab.";
    meta.hidden = false;
  }

  if (tier === "panel") {
    if (single) single.hidden = true;
    if (panel) panel.hidden = false;
    if (headline) headline.textContent = "Generating your panel review…";
    resetTrioCards();
    startTrioPoseCycle();
  } else {
    if (single) single.hidden = false;
    if (panel) panel.hidden = true;
    if (headline) headline.textContent = "Generating your full report…";
    const hero = document.getElementById("rex-hero");
    if (hero) hero.src = "/assets/rex.png";
    startHeroPoseCycle();
  }
  loader.hidden = false;
  startMessageCycle(tier);
}

export function hideGeneratingLoader() {
  const loader = document.getElementById("generating-loader");
  if (loader) loader.hidden = true;
  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.msg = loaderTimers.hero = loaderTimers.trio = null;
}

export function showLoaderError(tier, message) {
  const loader = document.getElementById("generating-loader");
  if (!loader) return;
  const card = loader.querySelector(".generating-card");
  const single = loader.querySelector('.rex-stage[data-mode="single"]');
  const panel = loader.querySelector('.rex-stage[data-mode="panel"]');
  const headline = document.getElementById("generating-headline");
  const status = document.getElementById("generating-status");
  const meta = document.getElementById("generating-meta");
  const actions = document.getElementById("generating-actions");

  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.msg = loaderTimers.hero = loaderTimers.trio = null;

  if (card) card.classList.add("is-error");
  if (headline) headline.textContent = "Something went wrong";
  if (status) {
    status.classList.remove("swapping");
    status.textContent = message || "We couldn't finish generating your report.";
  }
  if (meta) {
    meta.textContent =
      "Refreshing usually fixes it. If this keeps happening, contact support and include the job ID from the URL.";
  }
  if (actions) actions.hidden = false;

  if (tier === "panel") {
    if (single) single.hidden = true;
    if (panel) panel.hidden = false;
    document.querySelectorAll(".rex-trio-img").forEach((img) => {
      const trioCard = img.closest(".rex-trio-card");
      if (trioCard && !trioCard.classList.contains("is-done")) {
        img.src = "/assets/rex-concern.png";
      }
    });
  } else {
    if (single) single.hidden = false;
    if (panel) panel.hidden = true;
    const hero = document.getElementById("rex-hero");
    if (hero) {
      hero.src = "/assets/rex-concern.png";
      hero.classList.remove("swapping");
    }
  }

  loader.hidden = false;

  const retryBtn = document.getElementById("generating-retry");
  if (retryBtn) {
    retryBtn.onclick = () => window.location.reload();
  }
}

export function setPanelLoaderStatus(model, status) {
  const card = document.querySelector(`.rex-trio-card[data-model="${model}"]`);
  if (!card) return;
  const stateEl = card.querySelector(`[data-trio-state="${model}"]`);
  const img = card.querySelector(`[data-trio-img="${model}"]`);
  if (!stateEl) return;
  if (status === "running") {
    stateEl.textContent = "Reviewing…";
  } else if (status === "complete") {
    stateEl.textContent = "Done";
    card.classList.add("is-done");
    if (img) img.src = "/assets/rex-cheer.png";
  } else if (status === "error") {
    stateEl.textContent = "Failed";
    card.classList.remove("is-done");
  } else {
    stateEl.textContent = "Queued";
  }
}

function startMessageCycle(tier) {
  const messages = tier === "panel" ? PANEL_LOADER_MESSAGES : SINGLE_LOADER_MESSAGES;
  const statusEl = document.getElementById("generating-status");
  if (!statusEl) return;
  let idx = 0;
  statusEl.textContent = messages[0];
  statusEl.classList.remove("swapping");
  if (loaderTimers.msg) clearInterval(loaderTimers.msg);
  loaderTimers.msg = setInterval(() => {
    idx = (idx + 1) % messages.length;
    statusEl.classList.add("swapping");
    setTimeout(() => {
      statusEl.textContent = messages[idx];
      statusEl.classList.remove("swapping");
    }, 350);
  }, 4200);
}

function startHeroPoseCycle() {
  const hero = document.getElementById("rex-hero");
  if (!hero) return;
  let idx = 0;
  if (loaderTimers.hero) clearInterval(loaderTimers.hero);
  loaderTimers.hero = setInterval(() => {
    idx = (idx + 1) % REX_POSES.length;
    hero.classList.add("swapping");
    setTimeout(() => {
      hero.src = REX_POSES[idx];
      hero.classList.remove("swapping");
    }, 350);
  }, 3500);
}

function startTrioPoseCycle() {
  const imgs = document.querySelectorAll(".rex-trio-img");
  if (!imgs.length) return;
  let tick = 0;
  if (loaderTimers.trio) clearInterval(loaderTimers.trio);
  loaderTimers.trio = setInterval(() => {
    imgs.forEach((img, i) => {
      const card = img.closest(".rex-trio-card");
      if (card && card.classList.contains("is-done")) return;
      const pose = REX_POSES[(tick + i) % REX_POSES.length];
      img.classList.add("swapping");
      setTimeout(() => {
        img.src = pose;
        img.classList.remove("swapping");
      }, 350);
    });
    tick++;
  }, 2800);
}

function resetTrioCards() {
  ["claude", "gpt", "gemini"].forEach((k) => {
    const card = document.querySelector(`.rex-trio-card[data-model="${k}"]`);
    if (card) card.classList.remove("is-done");
    const stateEl = document.querySelector(`[data-trio-state="${k}"]`);
    if (stateEl) stateEl.textContent = "Reading…";
  });
}

// ---- Moved verbatim from js/app.js ----

export function renderTermCell(label, term) {
  const cell = document.createElement("div");
  cell.className = "term";

  const value = term?.value;
  const note = term?.note;
  const warning = term?.warning;
  const isEmpty = !value || String(value).trim() === "";

  // Always render label + value + note in fixed grid rows so cells
  // line up across the grid even when one is filled and another isn't.
  const labelEl = document.createElement("div");
  labelEl.className = "term-label";
  labelEl.textContent = label;
  cell.appendChild(labelEl);

  const valueEl = document.createElement("div");
  if (!isEmpty) {
    valueEl.className = "term-value";
    valueEl.textContent = value;
  } else {
    cell.classList.add("term-empty");
    valueEl.className = "term-value empty";
    valueEl.textContent = warning ? "Blank" : "Not filled";
  }
  cell.appendChild(valueEl);

  const noteEl = document.createElement("div");
  noteEl.className = "term-note";
  if (note) {
    noteEl.textContent = note;
  } else if (isEmpty && !warning) {
    noteEl.textContent = "Not detected in this scan";
  } else {
    noteEl.innerHTML = "&nbsp;";
  }
  cell.appendChild(noteEl);

  // Warning sits below the fixed grid rows when present.
  if (warning) {
    const warnEl = document.createElement("div");
    warnEl.className = "term-warning";
    warnEl.innerHTML = `<span class="msym" aria-hidden="true">warning</span><span>${escapeHtml(warning)}</span>`;
    cell.appendChild(warnEl);
  }

  return cell;
}

export function renderPanelPane(which, result) {
  const pane = document.querySelector(`.panel-pane[data-pane="${which}"]`);
  if (!pane) return;
  const loading = pane.querySelector(".panel-pane-loading");
  const content = pane.querySelector(".panel-pane-content");
  if (loading) loading.hidden = true;
  if (!content) return;
  content.innerHTML = renderReportHtml(result);
  content.hidden = false;
}

export function renderReportHtml(r) {
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

export function renderFullReport(r) {
  if (!r) return;
  document.getElementById("report-summary").textContent = r.summary || "";

  const modsEl = document.getElementById("report-mods");
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

  const tbl = document.getElementById("report-terms");
  tbl.innerHTML = "";
  Object.entries(r.full_terms || {}).forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(k)}</td><td>${escapeHtml(v == null ? "—" : String(v))}</td>`;
    tbl.appendChild(tr);
  });
}
