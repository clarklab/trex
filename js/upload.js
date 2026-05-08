// Chunked upload helper.

export async function uploadFile(file, onProgress) {
  const initRes = await fetch("/api/upload-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      mime_type: file.type,
    }),
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err.error || `upload-init failed: ${initRes.status}`);
  }
  const { job_id, chunk_size } = await initRes.json();

  const totalChunks = Math.ceil(file.size / chunk_size);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunk_size;
    const end = Math.min(start + chunk_size, file.size);
    const blob = file.slice(start, end);
    const buf = await blob.arrayBuffer();

    const res = await fetch(
      `/api/upload-chunk?job_id=${encodeURIComponent(job_id)}&chunk_index=${i}&total_chunks=${totalChunks}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buf,
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `chunk ${i} failed: ${res.status}`);
    }
    if (onProgress) onProgress(i + 1, totalChunks);
  }

  const completeRes = await fetch("/api/upload-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id, total_chunks: totalChunks }),
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error(err.error || `upload-complete failed: ${completeRes.status}`);
  }
  const data = await completeRes.json();

  // Browser-side trigger: Netlify functions can't reliably fetch their own
  // background functions (same-host fetch fails ~10s in). Fire from the
  // browser so the trigger isn't beholden to the parent function's lifecycle.
  // The background function is idempotent: if upload-complete also triggered
  // it via context.waitUntil, the duplicate is a no-op.
  fetch("/.netlify/functions/quick-scan-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id }),
    keepalive: true,
  }).catch((err) => {
    console.warn("Browser-side quick-scan trigger failed:", err);
  });

  return data;
}
