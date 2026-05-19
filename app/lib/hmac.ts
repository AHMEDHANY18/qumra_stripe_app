import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 sign/verify utilities — compatible with
 * core-service/src/cores/payment-app-service/lib/hmac.util.ts:
 *   signature = base64( HMAC-SHA256(rawBody, secret) )
 *
 * Always sign raw body bytes. Verify must run BEFORE JSON.parse.
 */

export function signRawBody(body: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

export function verifyRawBody(
  body: string | Buffer,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  let expected: string;
  try {
    expected = signRawBody(body, secret);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
