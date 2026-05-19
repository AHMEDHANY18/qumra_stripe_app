import { signRawBody } from "./hmac";

/**
 * Server-to-server callbacks to Qumra core informing it about the outcome
 * of a payment session. The provider — not the buyer's browser — is the
 * source of truth.
 *
 * core expects the URL path to use the bare ULID, NOT the full qid prefix.
 */

function ulidOf(qid: string): string {
  const parts = qid.split("/");
  return parts[parts.length - 1] || qid;
}

interface CoreResponse {
  sessionId?: string;
  status?: string;
  nextAction?: { redirectUrl?: string };
  [key: string]: unknown;
}

function coreUrl(): string {
  return process.env.QUMRA_CORE_URL ?? "http://localhost:4006/v1";
}

async function callCore(
  path: string,
  topic: string,
  paymentAppQid: string,
  body: Record<string, unknown>,
): Promise<CoreResponse> {
  const apiKey = process.env.QUMRA_API_KEY ?? "";
  const apiSecret = process.env.QUMRA_API_SECRET ?? "";
  if (!apiSecret) throw new Error("QUMRA_API_SECRET missing — cannot sign callback");

  const rawBody = JSON.stringify(body);
  const signature = signRawBody(rawBody, apiSecret);

  const res = await fetch(`${coreUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Qumra-Topic": topic,
      "X-Qumra-Hmac-Sha256": signature,
      "X-Qumra-App-Client-Id": apiKey,
      "X-Qumra-Payment-App-Qid": paymentAppQid,
      "X-Qumra-Timestamp": new Date().toISOString(),
    },
    body: rawBody,
  });

  const text = await res.text();
  let parsed: CoreResponse = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text } as CoreResponse;
  }

  if (!res.ok) {
    throw new Error(
      `core ${path} responded ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return parsed;
}

export function resolveSession(
  sessionQid: string,
  paymentAppQid: string,
  body: Record<string, unknown>,
) {
  return callCore(
    `/payment-sessions/${ulidOf(sessionQid)}/resolve`,
    "payment.session.resolve",
    paymentAppQid,
    body,
  );
}

export function rejectSession(
  sessionQid: string,
  paymentAppQid: string,
  body: Record<string, unknown>,
) {
  return callCore(
    `/payment-sessions/${ulidOf(sessionQid)}/reject`,
    "payment.session.reject",
    paymentAppQid,
    body,
  );
}

export function pendingSession(
  sessionQid: string,
  paymentAppQid: string,
  body: Record<string, unknown>,
) {
  return callCore(
    `/payment-sessions/${ulidOf(sessionQid)}/pending`,
    "payment.session.pending",
    paymentAppQid,
    body,
  );
}

export async function getSession(sessionQid: string): Promise<CoreResponse | null> {
  const apiKey = process.env.QUMRA_API_KEY ?? "";
  const res = await fetch(
    `${coreUrl()}/payment-sessions/${ulidOf(sessionQid)}`,
    {
      method: "GET",
      headers: {
        "X-Qumra-App-Client-Id": apiKey,
      },
    },
  );
  if (!res.ok) return null;
  try {
    return (await res.json()) as CoreResponse;
  } catch {
    return null;
  }
}
