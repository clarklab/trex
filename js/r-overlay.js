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
          <label class="overlay-slider-hint">Drag to compare · press F to flip</label>
          <input type="range" min="0" max="100" value="100" id="overlay-slider" />
        </div>
      </div>
    </div>
  `;

  try {
    const [pdfjs, manifest, userPdfBuf] = await Promise.all([
      import(/* @vite-ignore */ PDFJS_URL),
      fetch("/assets/trec-blanks/20-18/manifest.json").then((r) => {
        if (!r.ok) throw new Error("Couldn't load reference manifest");
        return r.json();
      }),
      fetch(
        "/api/report?id=" + encodeURIComponent(ctx.jobId) +
        "&token=" + encodeURIComponent(ctx.downloadToken) +
        "&format=pdf"
      ).then((r) => {
        if (!r.ok) throw new Error("Couldn't fetch your contract PDF");
        return r.arrayBuffer();
      }),
    ]);

    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const pdf = await pdfjs.getDocument({ data: userPdfBuf }).promise;
    const userImg = document.getElementById("overlay-user");
    const blankImg = document.getElementById("overlay-blank");
    const stack = document.getElementById("overlay-stack");

    // Set stack dimensions from the manifest (reference is the source of truth)
    stack.style.width = manifest.width + "px";
    stack.style.aspectRatio = `${manifest.width} / ${manifest.height}`;

    // Render page 1 of user PDF at the same width as the reference
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = manifest.width / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    userImg.src = canvas.toDataURL("image/png");
    blankImg.src = "/assets/trec-blanks/20-18/page-1.png";

    const loading = container.querySelector(".overlay-loading");
    if (loading) loading.remove();
    container.querySelector(".overlay-stage").hidden = false;

    // Slider wires --mix on the viewer container
    const slider = document.getElementById("overlay-slider");
    const viewer = document.getElementById("overlay-viewer");
    const onSlide = () => {
      viewer.style.setProperty("--mix", String(slider.value / 100));
    };
    slider.addEventListener("input", onSlide);
    onSlide();

    // F key flips between fully blank and fully user
    let flipped = false;
    document.addEventListener("keydown", (e) => {
      if (e.key === "f" || e.key === "F") {
        // Don't capture F keys when typing in inputs
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        flipped = !flipped;
        slider.value = flipped ? 0 : 100;
        onSlide();
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div class="overlay-error">
        Couldn't load the overlay tool. ${escapeHtml(err.message || "Unknown error.")}
        <button class="btn primary" onclick="window.location.reload()">Refresh</button>
      </div>
    `;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
