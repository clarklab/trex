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
  "/assets/rex.webp",
  "/assets/rex-concern.webp",
  "/assets/rex-cheer.webp",
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
    if (hero) hero.src = "/assets/rex.webp";
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
        img.src = "/assets/rex-concern.webp";
      }
    });
  } else {
    if (single) single.hidden = false;
    if (panel) panel.hidden = true;
    const hero = document.getElementById("rex-hero");
    if (hero) {
      hero.src = "/assets/rex-concern.webp";
      hero.classList.remove("swapping");
    }
  }

  loader.hidden = false;

  const retryBtn = document.getElementById("generating-retry");
  if (retryBtn) {
    retryBtn.onclick = async () => {
      // If we're on a /r/<code> dashboard, do a real backend retry.
      // Otherwise (upload page), just reload.
      const segs = window.location.pathname.split("/").filter(Boolean);
      if (segs[0] === "r" && segs[1]) {
        const code = segs[1];
        retryBtn.disabled = true;
        retryBtn.textContent = "Retrying…";
        try {
          const res = await fetch("/api/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recovery_code: code }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || ("Retry failed (" + res.status + ")"));
          }
          // Success: reload the page so the polling picks up the now-pending state.
          window.location.reload();
        } catch (err) {
          retryBtn.disabled = false;
          retryBtn.textContent = "Try again";
          const status = document.getElementById("generating-status");
          if (status) status.textContent = "Retry failed: " + err.message;
        }
      } else {
        window.location.reload();
      }
    };
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
    if (img) img.src = "/assets/rex-cheer.webp";
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

// ============================================================
// Full report rendering — the main /r/<code> dashboard payload.
// ============================================================

// Order, label, and Material Symbol icon for the page-1 deal-grid
// terms. Drawn from stage1.terms (preferred — already shaped with
// value/note/warning) with paid-tier extras pulled from stage2.full_terms.
const DEAL_FIELDS = [
  { key: "sales_price",        label: "Sales price",       icon: "request_quote" },
  { key: "down_payment",       label: "Down payment",      icon: "payments",       derived: true },
  { key: "earnest_money",      label: "Earnest money",     icon: "savings" },
  { key: "option_fee_period",  label: "Option fee · period", icon: "schedule" },
  { key: "closing_date",       label: "Closing",           icon: "event" },
  { key: "financing",          label: "Financing",         icon: "account_balance" },
  { key: "title_notice_period",label: "Title notice",      icon: "gavel" },
  { key: "special_provisions", label: "Special provisions", icon: "edit_note" },
];

// Group the full_terms key/value soup into readable buckets when we
// render the reference table on page 2+. A term key ends up in the
// FIRST bucket whose pattern matches it.
const TERMS_GROUPS = [
  {
    name: "Money",
    icon: "payments",
    match: /price|cash|earnest|option_fee|loan|financing|origination|interest|seller_contribution|service_contract/i,
  },
  {
    name: "Dates",
    icon: "event",
    match: /date|deadline|days|closing|effective|approval|option_period/i,
  },
  {
    name: "Property",
    icon: "home",
    match: /property|address|lot|block|county|city|subdivision|hoa|survey/i,
  },
  {
    name: "Parties",
    icon: "groups",
    match: /buyer|seller|broker|agent|attorney|escrow|title_company|listing/i,
  },
  {
    name: "Form & addenda",
    icon: "description",
    match: /form|addenda|leases|exclusions|reservations|disclosure|lead_based|non_realty/i,
  },
];

// Public entry: render the new dashboard report into `target` element.
//
// `r` is a Stage2Result.
// `ctx` is { stage1, downloadUrl, formId, formName, paidAt, tier }.
//
// Backwards-compat: if called with only (r), populate the legacy
// `#report-summary`, `#report-mods`, `#report-terms` DOM (the upload
// page's pre-/r/<code> recovery URL still uses these IDs).
export function renderFullReport(r, target, ctx) {
  if (!r) return;
  if (!target) {
    legacyPopulate(r);
    return;
  }
  const stage1 = (ctx && ctx.stage1) || null;
  const downloadUrl = (ctx && ctx.downloadUrl) || "";
  const formId = (ctx && ctx.formId) || (stage1 && stage1.form_id) || r.form_id || "";
  const formName = (ctx && ctx.formName) || (stage1 && stage1.form_name) || r.form_name || "";

  target.innerHTML = "";

  // Page 1 — snapshot card (eyebrow + form + actions)
  target.appendChild(buildSnapshotCard(r, stage1, formId, formName, downloadUrl));

  // Page 1 — deal grid + flag column
  target.appendChild(buildDealSection(r, stage1));

  // Page 2 — summary
  target.appendChild(buildSummarySection(r));

  // Page 3 — modifications
  target.appendChild(buildModificationsSection(r));

  // Page 4 — full terms reference
  target.appendChild(buildTermsSection(r));
}

function buildSnapshotCard(r, stage1, formId, formName, downloadUrl) {
  const card = document.createElement("section");
  card.className = "report-snapshot";

  const meta = document.createElement("div");
  meta.className = "snapshot-meta";

  const eyebrow = document.createElement("div");
  eyebrow.className = "snapshot-eyebrow";
  eyebrow.innerHTML =
    '<span class="msym" aria-hidden="true">verified_user</span>' +
    "<span>Deal snapshot</span>";
  meta.appendChild(eyebrow);

  const formTitle = document.createElement("h2");
  formTitle.className = "snapshot-form";
  formTitle.textContent = formName || "TREC contract review";
  meta.appendChild(formTitle);

  const formIdEl = document.createElement("div");
  formIdEl.className = "snapshot-form-id";
  const pageCount = stage1 && stage1.page_count;
  const modCount = (r.modifications || []).length;
  const idBits = [
    formId ? `TREC ${formId}` : null,
    pageCount ? `${pageCount} pages` : null,
    `${modCount} modification${modCount === 1 ? "" : "s"} flagged`,
  ].filter(Boolean);
  formIdEl.textContent = idBits.join("  ·  ");
  meta.appendChild(formIdEl);

  // Severity ribbon — counts pulled from modifications array (canonical)
  const counts = countSeverity(r.modifications || []);
  const ribbon = document.createElement("div");
  ribbon.className = "severity-bar";
  ribbon.appendChild(severityPill("high",   counts.high,   "High"));
  ribbon.appendChild(severityPill("medium", counts.medium, "Medium"));
  ribbon.appendChild(severityPill("low",    counts.low,    "Low"));
  meta.appendChild(ribbon);

  card.appendChild(meta);

  // Actions
  const actions = document.createElement("div");
  actions.className = "snapshot-actions";
  // PDF download: rasterizes the current dashboard via html2pdf.js,
  // delivered one-click as a real .pdf file. Wired in r.js via the
  // [data-action="download-pdf"] click delegate.
  const dl = document.createElement("button");
  dl.type = "button";
  dl.className = "r-action primary";
  dl.dataset.action = "download-pdf";
  dl.innerHTML =
    '<span class="msym" aria-hidden="true">download</span>' +
    '<span class="r-action-label">Download PDF</span>';
  actions.appendChild(dl);

  const print = document.createElement("button");
  print.type = "button";
  print.className = "r-action ghost";
  print.dataset.action = "print";
  print.innerHTML =
    '<span class="msym" aria-hidden="true">print</span>' +
    "<span>Print</span>";
  actions.appendChild(print);
  card.appendChild(actions);

  return card;
}

function severityPill(level, count, label) {
  const el = document.createElement("span");
  const isClean = count === 0 && (level === "high" || level === "medium");
  el.className = `severity-pill is-${isClean ? "clean" : level}`;
  el.innerHTML =
    '<span class="pip" aria-hidden="true"></span>' +
    `<span class="count">${count}</span>` +
    `<span>${escapeHtml(label)}</span>`;
  return el;
}

function countSeverity(mods) {
  const c = { high: 0, medium: 0, low: 0 };
  mods.forEach((m) => {
    const r = String(m.risk || "low").toLowerCase();
    if (r === "high") c.high++;
    else if (r === "medium" || r === "med") c.medium++;
    else c.low++;
  });
  return c;
}

function buildDealSection(r, stage1) {
  const section = document.createElement("section");
  section.className = "report-section";

  const head = document.createElement("div");
  head.className = "report-section-head";
  head.innerHTML =
    '<div>' +
    '  <div class="kicker"><span class="msym" aria-hidden="true">insights</span>At a glance</div>' +
    '  <h2>Deal terms</h2>' +
    '</div>' +
    '<div class="report-section-side">' +
    '  Pulled from your contract — every cell is what we found.' +
    '</div>';
  section.appendChild(head);

  // Build the 4-col deal grid
  const grid = document.createElement("div");
  grid.className = "report-deal-grid";

  const stage1Terms = (stage1 && stage1.terms) || {};
  const fullTerms = r.full_terms || {};

  DEAL_FIELDS.forEach((field) => {
    const data = field.derived
      ? deriveDealField(field.key, stage1Terms, fullTerms)
      : stage1Terms[field.key] || extrapolateDealField(field.key, fullTerms);
    grid.appendChild(buildDealCell(field, data));
  });

  section.appendChild(grid);

  // Headline flags (red flags from stage1, falling back to high/medium mods)
  const flags = (stage1 && stage1.red_flags) || [];
  const headlineMods = (r.modifications || [])
    .filter((m) => /^(high|medium|med)$/i.test(m.risk || ""))
    .slice(0, 6);
  const flagsBlock = document.createElement("div");
  flagsBlock.className = "report-flags";
  flagsBlock.innerHTML = '<h3>Headline flags</h3>';
  if (flags.length === 0 && headlineMods.length === 0) {
    const empty = document.createElement("div");
    empty.className = "report-flags-empty";
    empty.innerHTML =
      '<span class="msym" aria-hidden="true">check_circle</span>' +
      "<span>No high or medium-severity issues flagged. Looks clean.</span>";
    flagsBlock.appendChild(empty);
  } else {
    const items = flags.length
      ? flags.map((f) => ({ severity: f.severity, title: f.title }))
      : headlineMods.map((m) => ({ severity: m.risk, title: m.clause }));
    items.forEach((it) => {
      const sev = String(it.severity || "low").toLowerCase();
      const sevClass = sev === "med" ? "medium" : sev;
      const row = document.createElement("div");
      row.className = `report-flag is-${sevClass}`;
      row.innerHTML =
        '<span class="pip" aria-hidden="true"></span>' +
        `<span>${escapeHtml(it.title || "")}</span>`;
      flagsBlock.appendChild(row);
    });
  }
  section.appendChild(flagsBlock);

  return section;
}

// Pull a TermField-shaped value out of stage1.terms keyed by field.key.
// If absent, fall back to looking at full_terms with a few likely keys.
function extrapolateDealField(key, fullTerms) {
  const lookups = {
    sales_price: ["price", "sales_price_3C", "sales_price"],
    earnest_money: ["earnest_money"],
    option_fee_period: ["option_fee", "option_period_days"],
    closing_date: ["closing_date"],
    financing: ["financing_type", "loan_amount", "max_interest_rate"],
    title_notice_period: ["title_objection_deadline_days"],
    special_provisions: ["special_provisions"],
  };
  const keys = lookups[key] || [];
  for (const k of keys) {
    if (fullTerms[k] !== undefined && fullTerms[k] !== null && String(fullTerms[k]).trim() !== "") {
      return { value: String(fullTerms[k]), note: null, warning: null };
    }
  }
  return null;
}

// "down_payment" isn't a stage1 term; derive from sales price - financing
// or from full_terms.cash_at_closing_3A if present.
function deriveDealField(key, stage1Terms, fullTerms) {
  if (key !== "down_payment") return null;
  const cash = fullTerms.cash_at_closing_3A;
  const price = fullTerms.sales_price_3C || fullTerms.price;
  const financed = fullTerms.financing_amount_3B || fullTerms.loan_amount;
  if (cash != null && String(cash).trim() !== "") {
    let pct = null;
    if (price && cash) {
      const p = parseDollar(price);
      const c = parseDollar(cash);
      if (p && c) pct = `${Math.round((c / p) * 100)}% of price`;
    }
    return { value: String(cash), note: pct, warning: null };
  }
  if (price && financed) {
    const p = parseDollar(price);
    const f = parseDollar(financed);
    if (p && f && p > f) {
      const dp = p - f;
      const pct = Math.round((dp / p) * 100);
      return {
        value: "$" + dp.toLocaleString(),
        note: `${pct}% of $${p.toLocaleString()}`,
        warning: null,
      };
    }
  }
  return null;
}

function parseDollar(s) {
  if (s == null) return null;
  const m = String(s).match(/\$?([\d,]+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function buildDealCell(field, term) {
  const cell = document.createElement("div");
  cell.className = "deal-cell";

  const labelEl = document.createElement("div");
  labelEl.className = "deal-cell-label";
  labelEl.innerHTML =
    `<span class="msym" aria-hidden="true">${escapeHtml(field.icon)}</span>` +
    `<span>${escapeHtml(field.label)}</span>`;
  cell.appendChild(labelEl);

  const value = term && term.value;
  const note = term && term.note;
  const warning = term && term.warning;
  const isEmpty = !value || String(value).trim() === "";

  const valEl = document.createElement("div");
  valEl.className = "deal-cell-value" + (isEmpty ? " empty" : "");
  valEl.textContent = isEmpty ? "Not detected" : String(value);
  cell.appendChild(valEl);

  const noteEl = document.createElement("div");
  noteEl.className = "deal-cell-note";
  noteEl.innerHTML = note ? escapeHtml(String(note)) : "&nbsp;";
  cell.appendChild(noteEl);

  if (warning) {
    const w = document.createElement("div");
    w.className = "deal-cell-warning";
    w.innerHTML =
      '<span class="msym" aria-hidden="true">warning</span>' +
      `<span>${escapeHtml(warning)}</span>`;
    cell.appendChild(w);
  }

  return cell;
}

function buildSummarySection(r) {
  const section = document.createElement("section");
  section.className = "report-section";

  const head = document.createElement("div");
  head.className = "report-section-head";
  head.innerHTML =
    '<div>' +
    '  <div class="kicker"><span class="msym" aria-hidden="true">summarize</span>Plain-English summary</div>' +
    '  <h2>What this contract is about</h2>' +
    '</div>';
  section.appendChild(head);

  const prose = document.createElement("div");
  prose.className = "report-prose";
  // Split summary on blank lines so paragraphs render correctly
  const paras = String(r.summary || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) {
    prose.innerHTML = '<p style="color:var(--muted)">No summary generated.</p>';
  } else {
    prose.innerHTML = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  }
  section.appendChild(prose);

  return section;
}

function buildModificationsSection(r) {
  const section = document.createElement("section");
  section.className = "report-section report-section--mods";

  const counts = countSeverity(r.modifications || []);
  const head = document.createElement("div");
  head.className = "report-section-head";
  head.innerHTML =
    '<div>' +
    '  <div class="kicker"><span class="msym" aria-hidden="true">flag</span>Findings</div>' +
    '  <h2>Modifications & flags</h2>' +
    '</div>' +
    '<div class="report-section-side">' +
    `  ${(r.modifications || []).length} item${(r.modifications || []).length === 1 ? "" : "s"} · ` +
    `${counts.high}H · ${counts.medium}M · ${counts.low}L` +
    "</div>";
  section.appendChild(head);

  const list = document.createElement("div");
  list.className = "mod-list";

  const mods = r.modifications || [];
  if (mods.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mod-empty";
    empty.innerHTML =
      '<span class="msym" aria-hidden="true">check_circle</span>' +
      "<span><strong>No modifications detected.</strong> The contract reads as a clean copy of the standard form.</span>";
    list.appendChild(empty);
  } else {
    // High-severity items first, then medium, then low — most useful first.
    const sorted = [...mods].sort(
      (a, b) => severityWeight(b.risk) - severityWeight(a.risk),
    );
    sorted.forEach((m, i) => list.appendChild(buildModCard(m, i + 1)));
  }
  section.appendChild(list);

  return section;
}

function severityWeight(risk) {
  const r = String(risk || "low").toLowerCase();
  if (r === "high") return 3;
  if (r === "medium" || r === "med") return 2;
  return 1;
}

function buildModCard(m, index) {
  const risk = String(m.risk || "low").toLowerCase();
  const riskClass = risk === "med" ? "medium" : risk;
  const card = document.createElement("article");
  card.className = `mod-card risk-${riskClass}`;

  // Head: numbered prefix + risk badge + (priority icon for high) + clause.
  // Sits inside its own bar with a hairline divider — no colored card edge.
  const head = document.createElement("div");
  head.className = "mod-head";
  const numStr = typeof index === "number" ? String(index).padStart(2, "0") : "";
  const numHtml = numStr
    ? `<span class="mod-num" aria-hidden="true">${numStr}</span>`
    : "";
  // Only high-severity items get the extra priority icon — keeps medium/low
  // visually quiet so high stands out in a long list.
  const priorityIcon =
    riskClass === "high"
      ? '<span class="msym mod-clause-icon" aria-hidden="true">priority_high</span>'
      : "";
  head.innerHTML =
    numHtml +
    `<span class="risk-badge risk-${riskClass}">` +
    '<span class="pip" aria-hidden="true"></span>' +
    `<span>${escapeHtml(riskClass.toUpperCase())}</span>` +
    "</span>" +
    priorityIcon +
    `<span class="mod-clause">${escapeHtml(m.clause || "")}</span>`;
  card.appendChild(head);

  // Body wrapper — keeps padding control separate from the head.
  const body = document.createElement("div");
  body.className = "mod-body";

  // Compare panels
  if (m.standard_text || m.contract_text) {
    const cmp = document.createElement("div");
    cmp.className = "mod-cmp";
    if (m.standard_text) {
      const a = document.createElement("div");
      a.className = "mod-cmp-block is-standard";
      a.innerHTML =
        '<span class="mod-cmp-label">Standard form</span>' +
        `<span>${escapeHtml(m.standard_text)}</span>`;
      cmp.appendChild(a);
    }
    if (m.contract_text) {
      const b = document.createElement("div");
      b.className = "mod-cmp-block is-contract";
      b.innerHTML =
        '<span class="mod-cmp-label">This contract</span>' +
        `<span>${escapeHtml(m.contract_text)}</span>`;
      cmp.appendChild(b);
    }
    body.appendChild(cmp);
  }

  // Explanation
  if (m.explanation) {
    const p = document.createElement("p");
    p.className = "mod-explanation";
    p.textContent = m.explanation;
    body.appendChild(p);
  }

  // Questions to ask — collapsible
  if (m.questions && m.questions.length) {
    const det = document.createElement("details");
    det.className = "mod-questions";
    const sum = document.createElement("summary");
    sum.innerHTML =
      '<span class="msym" aria-hidden="true">chevron_right</span>' +
      `<span>Questions to ask · ${m.questions.length}</span>`;
    det.appendChild(sum);
    const ul = document.createElement("ul");
    m.questions.forEach((q) => {
      const li = document.createElement("li");
      li.textContent = q;
      ul.appendChild(li);
    });
    det.appendChild(ul);
    body.appendChild(det);
  }

  card.appendChild(body);
  return card;
}

function buildTermsSection(r) {
  const section = document.createElement("section");
  section.className = "report-section";

  const head = document.createElement("div");
  head.className = "report-section-head";
  head.innerHTML =
    '<div>' +
    '  <div class="kicker"><span class="msym" aria-hidden="true">data_table</span>Reference</div>' +
    '  <h2>Full extracted terms</h2>' +
    '</div>' +
    '<div class="report-section-side">' +
    `  ${Object.keys(r.full_terms || {}).length} fields` +
    "</div>";
  section.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "terms-table";

  const entries = Object.entries(r.full_terms || {});
  // Bucket each entry into the first matching group; spillover ends up in
  // a "more" bucket.
  const buckets = TERMS_GROUPS.map((g) => ({ ...g, rows: [] }));
  const more = { name: "More", icon: "more_horiz", rows: [] };
  entries.forEach(([k, v]) => {
    const g = buckets.find((b) => b.match.test(k));
    (g ? g : more).rows.push([k, v]);
  });
  buckets.forEach((g) => { if (g.rows.length) wrap.appendChild(buildTermsGroup(g)); });
  if (more.rows.length) wrap.appendChild(buildTermsGroup(more));

  section.appendChild(wrap);
  return section;
}

function buildTermsGroup(group) {
  const block = document.createElement("div");
  block.className = "terms-group";

  const head = document.createElement("div");
  head.className = "terms-group-head";
  head.innerHTML =
    `<span class="msym" aria-hidden="true">${escapeHtml(group.icon)}</span>` +
    `<span>${escapeHtml(group.name)}</span>`;
  block.appendChild(head);

  const rows = document.createElement("div");
  rows.className = "terms-rows";
  group.rows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "terms-row";
    const isEmpty = v == null || String(v).trim() === "" || String(v).toUpperCase() === "BLANK";
    row.innerHTML =
      `<div class="terms-row-key">${escapeHtml(humanizeKey(k))}</div>` +
      `<div class="terms-row-val${isEmpty ? " empty" : ""}">` +
      escapeHtml(isEmpty ? "Not specified" : String(v)) +
      "</div>";
    rows.appendChild(row);
  });
  block.appendChild(rows);
  return block;
}

function humanizeKey(k) {
  return String(k)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // Preserve common acronyms / IDs
    .replace(/\b(Hoa|Trec|Pdf|Llc|Pllc|Url|3a|3b|3c|22)\b/gi, (m) => m.toUpperCase());
}

// ============================================================
// Panel-tier rendering. Each model's pane gets the same dashboard
// rendered above, scoped to a #panel-pane container.
// ============================================================

export function renderPanelPane(which, result) {
  const pane = document.querySelector(`.panel-pane[data-pane="${which}"]`);
  if (!pane) return;
  const loading = pane.querySelector(".panel-pane-loading");
  const content = pane.querySelector(".panel-pane-content");
  if (loading) loading.hidden = true;
  if (!content) return;
  content.innerHTML = "";
  // Reuse the full-report renderer with no ctx — produces the same
  // editorial sections without a snapshot download button.
  renderFullReport(result, content, {});
  content.hidden = false;
}

// Legacy render that returns an HTML string instead of populating a
// container. Some older callers (panel-pane export, some recovery paths)
// still expect this shape — keep it for backwards compat.
export function renderReportHtml(r) {
  const tmp = document.createElement("div");
  renderFullReport(r, tmp, {});
  return tmp.innerHTML;
}

// Legacy: populate the upload-page's pre-/r/<code> report DOM with the
// old flat structure. New callers always pass a container; this exists
// only so bookmarks of the legacy /?job=X&token=Y URL still render
// SOMETHING when reopened.
function legacyPopulate(r) {
  const summaryEl = document.getElementById("report-summary");
  if (summaryEl) summaryEl.textContent = r.summary || "";

  const modsEl = document.getElementById("report-mods");
  if (modsEl) {
    modsEl.innerHTML = "";
    (r.modifications || []).forEach((m) => {
      const card = buildModCard(m);
      modsEl.appendChild(card);
    });
  }

  const tbl = document.getElementById("report-terms");
  if (tbl) {
    tbl.innerHTML = "";
    Object.entries(r.full_terms || {}).forEach(([k, v]) => {
      const tr = document.createElement("tr");
      const isEmpty = v == null || String(v).trim() === "" || String(v).toUpperCase() === "BLANK";
      tr.innerHTML =
        `<td>${escapeHtml(humanizeKey(k))}</td>` +
        `<td>${escapeHtml(isEmpty ? "Not specified" : String(v))}</td>`;
      tbl.appendChild(tr);
    });
  }
}
