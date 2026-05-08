// Polling helpers for job status and checkout status.

const MAX_POLL_MS = 10 * 60 * 1000;

export function pollJobStatus(jobId, onUpdate, onError) {
  const start = Date.now();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (Date.now() - start > MAX_POLL_MS) {
      onError(new Error("Timed out waiting for analysis"));
      return;
    }
    try {
      const res = await fetch(`/api/job-status?id=${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `status ${res.status}`);
      }
      const data = await res.json();
      onUpdate(data);
      if (
        data.stage1?.status === "complete" &&
        (data.stage2?.status === "complete" || data.stage2?.status === "error")
      ) {
        stopped = true;
        return;
      }
      if (data.stage1?.status === "error" && data.stage2?.status === "error") {
        stopped = true;
        return;
      }
    } catch (err) {
      console.warn("poll error:", err);
    }
    setTimeout(tick, 3000);
  };
  tick();
  return () => { stopped = true; };
}

export function pollCheckoutStatus(sessionId, onPaid, onError) {
  const start = Date.now();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (Date.now() - start > MAX_POLL_MS) {
      onError(new Error("Payment timed out"));
      return;
    }
    try {
      const res = await fetch(
        `/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === "paid") {
          stopped = true;
          onPaid(data);
          return;
        }
      }
    } catch (err) {
      console.warn("checkout poll error:", err);
    }
    setTimeout(tick, 2000);
  };
  tick();
  return () => { stopped = true; };
}
