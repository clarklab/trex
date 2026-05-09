// netlify/lib/recovery-code.ts
import { randomBytes } from "node:crypto";

// 12-char URL-safe code (~72 bits of entropy). Suitable for shareable URLs:
// not guessable, not embarrassing-looking, fits in a tweet.
export function generateRecoveryCode(): string {
  return randomBytes(9).toString("base64url");
}

export function isValidRecoveryCode(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{12}$/.test(s);
}
