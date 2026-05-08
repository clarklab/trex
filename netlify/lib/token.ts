import { createHmac } from "node:crypto";

const TOKEN_TTL_MS = 86_400_000;

function getSecret(): string {
  const s = Netlify.env.get("DOWNLOAD_TOKEN_SECRET");
  if (!s) {
    throw new Error("DOWNLOAD_TOKEN_SECRET is not configured");
  }
  return s;
}

export function signToken(sessionId: string, ttlMs = TOKEN_TTL_MS): string {
  const expiry = Date.now() + ttlMs;
  const payload = `${sessionId}:${expiry}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [sessionId, expiryStr, sig] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
    const expected = createHmac("sha256", getSecret())
      .update(`${sessionId}:${expiryStr}`)
      .digest("hex");
    if (sig !== expected) return null;
    return sessionId;
  } catch {
    return null;
  }
}
