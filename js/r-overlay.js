// js/r-overlay.js — pixel-overlay viewer, lazy-imported by r.js when the
// Overlay tab is first clicked.
//
// Renders the user PDF in-browser via pdfjs-dist (loaded from CDN).
// Reference PNGs are pre-baked at /assets/trec-blanks/<form_id>/.

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";

export async function mount(container, ctx) {
  // ctx: { jobId, downloadToken, formId }
  if (ctx.formId !== "20-18") {
    container.innerHTML =
      '<div class="overlay-unsupported">Visual overlay coming soon for this form.</div>';
    return;
  }

  container.innerHTML = `
    <div class="overlay-viewer" id="overlay-viewer">
      <div class="overlay-loading">Loading overlay viewer…</div>
      <div class="overlay-stage" hidden>
        <div class="overlay-layout">
          <div class="overlay-page-col">
            <div class="overlay-labels">
              <div class="overlay-label overlay-label-user">Your Contract</div>
              <div class="overlay-label overlay-label-blank">Blank Original</div>
            </div>
            <div class="overlay-stack" id="overlay-stack">
              <img class="overlay-img-blank" id="overlay-blank" alt="" />
              <img class="overlay-img-user"  id="overlay-user"  alt="" />
            </div>
          </div>

          <aside class="overlay-controls-col">
            <div class="overlay-control-card">
              <div class="overlay-control-card-head">
                <span class="msym" aria-hidden="true">tune</span>
                <span>Compare</span>
              </div>
              <input type="range" min="0" max="100" value="100" id="overlay-slider" class="overlay-slider" />
              <div class="overlay-slider-axis">
                <span>Blank</span>
                <span>Yours</span>
              </div>
              <button class="overlay-autoflip" id="overlay-autoflip" type="button" aria-pressed="false">
                <span class="msym overlay-autoflip-icon" aria-hidden="true">sync</span>
                <span class="overlay-autoflip-label">Auto-flip</span>
              </button>
              <p class="overlay-control-hint">Drag · press <kbd>F</kbd> to flip</p>
            </div>

            <div class="overlay-control-card">
              <div class="overlay-control-card-head">
                <span class="msym" aria-hidden="true">menu_book</span>
                <span>Pages</span>
              </div>
              <div class="overlay-nav">
                <button class="overlay-nav-btn" id="overlay-prev" aria-label="Previous page">
                  <span class="msym" aria-hidden="true">chevron_left</span>
                </button>
                <span class="overlay-nav-page" id="overlay-page-indicator">Page 1 of …</span>
                <button class="overlay-nav-btn" id="overlay-next" aria-label="Next page">
                  <span class="msym" aria-hidden="true">chevron_right</span>
                </button>
              </div>
              <div class="overlay-thumbs" id="overlay-thumbs"></div>
              <p class="overlay-control-hint">← → arrow keys also work</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;

  let pdfjs, manifest, pdf;
  try {
    let userPdfBuf;
    [pdfjs, manifest, userPdfBuf] = await Promise.all([
      import(/* @vite-ignore */ PDFJS_URL),
      fetch("/assets/trec-blanks/20-18/manifest.json").then((r) => {
        if (!r.ok) throw new Error("Couldn't load reference manifest");
        return r.json();
      }),
      fetch(
        "/api/report?id=" + encodeURIComponent(ctx.jobId) +
        "&token=" + encodeURIComponent(ctx.downloadToken) +
        "&format=contract"
      ).then(async (r) => {
        if (!r.ok) throw new Error("Couldn't fetch your contract PDF");
        return r.arrayBuffer();
      }),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    pdf = await pdfjs.getDocument({ data: userPdfBuf }).promise;
  } catch (err) {
    container.innerHTML = `
      <div class="overlay-error">
        Couldn't load the overlay tool. ${escapeHtml(err.message || "Unknown error.")}
        <button class="btn primary" onclick="window.location.reload()">Refresh</button>
      </div>
    `;
    return;
  }

  const userImg = document.getElementById("overlay-user");
  const blankImg = document.getElementById("overlay-blank");
  const stack = document.getElementById("overlay-stack");
  stack.style.width = "100%";
  stack.style.maxWidth = manifest.width + "px";
  stack.style.aspectRatio = `${manifest.width} / ${manifest.height}`;

  // Cap to whichever is smaller: the user's PDF or the blank reference.
  // Pages beyond the standard form (addenda, disclosures, attachments)
  // can't be overlaid — there's no reference to compare against.
  const referencePages = manifest.page_count;
  const userPages = pdf.numPages;
  const totalPages = Math.min(userPages, referencePages);
  const extraPages = Math.max(0, userPages - referencePages);
  let currentPage = 1;
  const pageCache = new Map();

  async function renderPage(n) {
    if (n < 1 || n > totalPages) return;
    if (pageCache.has(n)) {
      userImg.src = pageCache.get(n);
      blankImg.src = `/assets/trec-blanks/20-18/page-${n}.png`;
      currentPage = n;
      updatePageIndicator();
      updateActiveThumb();
      return;
    }
    const page = await pdf.getPage(n);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = manifest.width / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    pageCache.set(n, dataUrl);
    userImg.src = dataUrl;
    blankImg.src = `/assets/trec-blanks/20-18/page-${n}.png`;
    currentPage = n;
    updatePageIndicator();
    updateActiveThumb();
  }

  function updatePageIndicator() {
    const ind = document.getElementById("overlay-page-indicator");
    if (ind) ind.textContent = `Page ${currentPage} of ${totalPages}`;
  }
  function updateActiveThumb() {
    document.querySelectorAll(".overlay-thumb").forEach((b) =>
      b.classList.toggle("is-active", Number(b.dataset.page) === currentPage),
    );
    const active = document.querySelector(".overlay-thumb.is-active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  // Build thumbnail strip — uses the blank reference PNGs (same shape as user
  // page, already on CDN, instant load — and the user's content is what
  // changes which we see in the slider, not the thumbs).
  const thumbs = document.getElementById("overlay-thumbs");
  for (let n = 1; n <= totalPages; n++) {
    const btn = document.createElement("button");
    btn.className = "overlay-thumb" + (n === 1 ? " is-active" : "");
    btn.dataset.page = String(n);
    btn.title = "Page " + n;
    btn.innerHTML = `<img src="/assets/trec-blanks/20-18/page-${n}.png" alt="" /><span>${n}</span>`;
    btn.onclick = () => renderPage(n);
    thumbs.appendChild(btn);
  }

  // Manual alignment nudge controls — appended to the controls column and
  // persisted per-job in localStorage. Lets users compensate for misalignment
  // when their user PDF doesn't line up exactly with the standard form
  // (scanned, slightly different DPI, etc.).
  container.querySelector(".overlay-controls-col").insertAdjacentHTML("beforeend", `
    <details class="overlay-align">
      <summary>
        <span class="msym" aria-hidden="true">tune</span>
        <span>Adjust alignment</span>
      </summary>
      <div class="overlay-align-controls">
        <label>X offset
          <input type="range" min="-20" max="20" step="1" value="0" id="ov-off-x" />
        </label>
        <label>Y offset
          <input type="range" min="-20" max="20" step="1" value="0" id="ov-off-y" />
        </label>
        <label>Scale
          <input type="range" min="0.95" max="1.05" step="0.001" value="1" id="ov-scale" />
        </label>
        <button class="overlay-nav-btn" id="ov-reset">Reset</button>
      </div>
    </details>
  `);

  const ALIGN_KEY = "trex-align:" + ctx.jobId;
  function loadAlignment() {
    try { return JSON.parse(localStorage.getItem(ALIGN_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveAlignment(a) {
    try { localStorage.setItem(ALIGN_KEY, JSON.stringify(a)); } catch {}
  }
  function applyAlignment(a) {
    const v = document.getElementById("overlay-viewer");
    v.style.setProperty("--off-x", (a.x ?? 0) + "px");
    v.style.setProperty("--off-y", (a.y ?? 0) + "px");
    v.style.setProperty("--scale", String(a.scale ?? 1));
  }

  const align = loadAlignment();
  document.getElementById("ov-off-x").value = String(align.x ?? 0);
  document.getElementById("ov-off-y").value = String(align.y ?? 0);
  document.getElementById("ov-scale").value = String(align.scale ?? 1);
  applyAlignment(align);

  const onAlignChange = () => {
    const a = {
      x: Number(document.getElementById("ov-off-x").value),
      y: Number(document.getElementById("ov-off-y").value),
      scale: Number(document.getElementById("ov-scale").value),
    };
    applyAlignment(a);
    saveAlignment(a);
  };
  ["ov-off-x", "ov-off-y", "ov-scale"].forEach((id) => {
    document.getElementById(id).addEventListener("input", onAlignChange);
  });
  document.getElementById("ov-reset").onclick = () => {
    document.getElementById("ov-off-x").value = "0";
    document.getElementById("ov-off-y").value = "0";
    document.getElementById("ov-scale").value = "1";
    onAlignChange();
  };

  // If the user's PDF has pages beyond the standard form, show a note
  // in the controls column. Those pages are addenda — they can't be
  // overlaid against the standard form.
  if (extraPages > 0) {
    const note = document.createElement("p");
    note.className = "overlay-extra-note";
    note.innerHTML =
      '<span class="msym" aria-hidden="true">info</span>' +
      `<span>Your contract has <strong>${extraPages}</strong> additional ` +
      `page${extraPages === 1 ? "" : "s"} beyond the standard form ` +
      "(addenda, disclosures). Those aren't part of the standard 20-18, " +
      "so they're not shown here.</span>";
    container.querySelector(".overlay-controls-col").appendChild(note);
  }

  // Initial render
  await renderPage(1);

  const loading = container.querySelector(".overlay-loading");
  if (loading) loading.remove();
  container.querySelector(".overlay-stage").hidden = false;

  // Slider
  const slider = document.getElementById("overlay-slider");
  const viewer = document.getElementById("overlay-viewer");
  const onSlide = () => {
    viewer.style.setProperty("--mix", String(slider.value / 100));
  };
  slider.addEventListener("input", () => {
    // Manual interaction stops auto-flip.
    stopAutoFlip();
    onSlide();
  });
  onSlide();

  // Auto-flip: hands-free side-to-side animation. Toggling the button
  // adds .is-autoflip to the viewer (which lengthens the user-image
  // opacity transition) and bounces the slider between 0 and 100 every
  // ~1300ms. Click again or grab the slider to stop.
  const autoBtn = document.getElementById("overlay-autoflip");
  const autoLabel = autoBtn.querySelector(".overlay-autoflip-label");
  let autoflipTimer = null;
  function startAutoFlip() {
    if (autoflipTimer) return;
    viewer.classList.add("is-autoflip");
    autoBtn.setAttribute("aria-pressed", "true");
    autoBtn.classList.add("is-on");
    if (autoLabel) autoLabel.textContent = "Stop auto-flip";
    let target = slider.value === "0" ? 100 : 0;
    const step = () => {
      slider.value = String(target);
      onSlide();
      target = target === 0 ? 100 : 0;
    };
    step();
    autoflipTimer = setInterval(step, 1300);
  }
  function stopAutoFlip() {
    if (!autoflipTimer) return;
    clearInterval(autoflipTimer);
    autoflipTimer = null;
    viewer.classList.remove("is-autoflip");
    autoBtn.setAttribute("aria-pressed", "false");
    autoBtn.classList.remove("is-on");
    if (autoLabel) autoLabel.textContent = "Auto-flip";
  }
  autoBtn.addEventListener("click", () => {
    if (autoflipTimer) stopAutoFlip();
    else startAutoFlip();
  });

  // Prev/Next
  document.getElementById("overlay-prev").onclick = () => {
    if (currentPage > 1) renderPage(currentPage - 1);
  };
  document.getElementById("overlay-next").onclick = () => {
    if (currentPage < totalPages) renderPage(currentPage + 1);
  };

  // Keyboard: F flip, arrows nav, Esc back to Full Report
  let flipped = false;
  const onKeyDown = (e) => {
    // Only handle keys when the Overlay tab is the active one. The
    // dashboard hides the other panes via [data-pane="overlay"] hidden
    // state — without this guard, pressing Esc on the Chat or Full
    // Report tab would unintentionally fire overlay:exit and snap
    // the user back to Full Report.
    const overlayPane = document.querySelector('.r-tab-pane[data-pane="overlay"]');
    if (!overlayPane || overlayPane.hidden) return;

    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      stopAutoFlip();
      flipped = !flipped;
      slider.value = flipped ? 0 : 100;
      onSlide();
    } else if (e.key === "ArrowLeft" && currentPage > 1) {
      e.preventDefault();
      renderPage(currentPage - 1);
    } else if (e.key === "ArrowRight" && currentPage < totalPages) {
      e.preventDefault();
      renderPage(currentPage + 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      container.dispatchEvent(new CustomEvent("overlay:exit", { bubbles: true }));
    }
  };
  document.addEventListener("keydown", onKeyDown);
  // (We don't bother removing the listener — the overlay tab persists for the
  //  page lifetime; if it's hidden the user isn't pressing keys for it anyway.)

  updatePageIndicator();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
