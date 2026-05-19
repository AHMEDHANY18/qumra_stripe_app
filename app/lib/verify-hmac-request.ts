import { verifyRawBody } from "./hmac";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // ±5 min, matches core

export interface VerifiedCoreRequest {
  rawBody: string;
  body: Record<string, unknown>;
  topic: string;
  paymentAppQid: string;
  appClientId: string;
  timestamp: string;
}

export type VerifyResult =
  | { ok: true; data: VerifiedCoreRequest }
  | { ok: false; status: number; error: string };

/**
 * Verifies an inbound HMAC-signed request from Qumra core. Mirrors the
 * outbound contract in core-service/src/cores/payment-app-service/
 * services/call-payment-app.service.ts:
 *
 *   X-Qumra-Topic
 *   X-Qumra-Hmac-Sha256        — base64(HMAC-SHA256(rawBody, app.secretKey))
 *   X-Qumra-App-Client-Id      — clientId of the App
 *   X-Qumra-Payment-App-Qid    — which PaymentApp this call is for
 *   X-Qumra-Timestamp          — ISO-8601, ±5min tolerance
 *
 * Dev escape hatch: when DEV_MOCK_BYPASS_TOKEN matches the
 * `X-Dev-Mock-Bypass` header, HMAC verification is skipped.
 */
export async function verifyCoreRequest(
  request: Request,
): Promise<VerifyResult> {
  const rawBody = await request.text();
  const secret = process.env.QUMRA_API_SECRET ?? "";

  const bypassToken = process.env.DEV_MOCK_BYPASS_TOKEN;
  const headerBypass = request.headers.get("x-dev-mock-bypass");
  const isBypassed =
    process.env.NODE_ENV !== "production" &&
    !!bypassToken &&
    !!headerBypass &&
    bypassToken === headerBypass;

  const topic = request.headers.get("x-qumra-topic") ?? "";
  const signature = request.headers.get("x-qumra-hmac-sha256");
  const appClientId = request.headers.get("x-qumra-app-client-id") ?? "";
  const paymentAppQid = request.headers.get("x-qumra-payment-app-qid") ?? "";
  const timestamp = request.headers.get("x-qumra-timestamp") ?? "";

  if (!paymentAppQid) {
    return {
      ok: false,
      status: 401,
      error: "Missing X-Qumra-Payment-App-Qid header",
    };
  }

  if (!isBypassed) {
    if (!signature) {
      return {
        ok: false,
        status: 401,
        error: "Missing X-Qumra-Hmac-Sha256 header",
      };
    }
    if (timestamp) {
      const ts = Date.parse(timestamp);
      if (
        Number.isNaN(ts) ||
        Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS
      ) {
        return {
          ok: false,
          status: 401,
          error: "Timestamp out of acceptable range (±5min)",
        };
      }
    }
    if (!verifyRawBody(rawBody, signature, secret)) {
      return { ok: false, status: 401, error: "HMAC signature mismatch" };
    }
  }

  let body: Record<string, unknown>;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  return {
    ok: true,
    data: { rawBody, body, topic, paymentAppQid, appClientId, timestamp },
  };
}
