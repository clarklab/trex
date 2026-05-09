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
        <div class="overlay-labels">
          <div class="overlay-label overlay-label-user">Your Contract</div>
          <div class="overlay-label overlay-label-blank">Blank Original</div>
        </div>
        <div class="overlay-stack" id="overlay-stack">
          <img class="overlay-img-blank" id="overlay-blank" alt="" />
          <img class="overlay-img-user"  id="overlay-user"  alt="" />
        </div>
        <div class="overlay-slider-row">
          <label class="overlay-slider-hint">Drag to compare · press F to flip · ← → for pages</label>
          <input type="range" min="0" max="100" value="100" id="overlay-slider" />
        </div>
        <div class="overlay-nav">
          <button class="overlay-nav-btn" id="overlay-prev">‹ Prev</button>
          <span class="overlay-nav-page" id="overlay-page-indicator">Page 1 of …</span>
          <button class="overlay-nav-btn" id="overlay-next">Next ›</button>
        </div>
        <div class="overlay-thumbs" id="overlay-thumbs"></div>
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
        "&format=pdf"
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
  stack.style.width = manifest.width + "px";
  stack.style.aspectRatio = `${manifest.width} / ${manifest.height}`;

  const totalPages = pdf.numPages;
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
  slider.addEventListener("input", onSlide);
  onSlide();

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
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
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
