import { signRawBody } from "./hmac";
import { getStoreSettings } from "~/db.server";

interface RegistrationResult {
  paymentAppQid: string;
  paymentAppId: string;
  isPrimary: boolean;
}

interface RegisterOpts {
  /**
   * Bearer access token issued by Qumra after OAuth install completes.
   * If omitted we fall back to HMAC-signed registration (dev/testing only).
   */
  accessToken?: string;
}

function coreUrl(): string {
  return process.env.QUMRA_CORE_URL ?? "http://localhost:4006/v1";
}

/**
 * Registers this app as a payment provider for a specific installation.
 * Mirrors the contract in:
 *   core-service/src/cores/payment-app-service/controllers/
 *     payment-apps-from-installation.controller.ts
 */
export async function registerPaymentProvider(
  store: string,
  appUrl: string,
  opts: RegisterOpts = {},
): Promise<RegistrationResult> {
  const apiKey = process.env.QUMRA_API_KEY ?? "";
  const apiSecret = process.env.QUMRA_API_SECRET ?? "";

  const body = {
    urls: {
      paymentSession: `${appUrl}/payment-session`,
      refundSession: `${appUrl}/refund-session`,
      captureSession: `${appUrl}/capture-session`,
      voidSession: `${appUrl}/void-session`,
    },
    supportedCurrencies: ["USD", "SAR", "EGP", "AED", "EUR", "GBP"],
    displayName: "Stripe Payment by Qumra",
    description: "Credit cards, Apple Pay, Google Pay via Stripe Checkout",
    setPrimary: true,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.accessToken) {
    headers["Authorization"] = `Bearer ${opts.accessToken}`;
  } else {
    // Dev fallback: sign with the app secret. Production should always use
    // the installation's access token.
    const rawBody = JSON.stringify(body);
    headers["X-Qumra-App-Client-Id"] = apiKey;
    headers["X-Qumra-Hmac-Sha256"] = signRawBody(rawBody, apiSecret);
    headers["X-Qumra-Timestamp"] = new Date().toISOString();
  }

  const res = await fetch(`${coreUrl()}/payment-apps/from-installation`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `payment-apps/from-installation responded ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  const parsed = JSON.parse(text) as { data?: RegistrationResult };
  if (!parsed.data?.paymentAppQid) {
    throw new Error(
      `Unexpected registration response: ${text.slice(0, 300)}`,
    );
  }

  await getStoreSettings().updateOne(
    { store },
    {
      $set: {
        paymentAppQid: parsed.data.paymentAppQid,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        store,
        stripeSecretKey: null,
        stripePublishableKey: null,
        stripeWebhookSecret: null,
        stripeWebhookId: null,
        stripeAccountId: null,
        configured: false,
        testMode: true,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  return parsed.data;
}

export async function ensurePaymentProviderRegistered(
  store: string,
  appUrl: string,
  accessToken?: string,
): Promise<string> {
  const settings = await getStoreSettings().findOne({ store });
  if (settings?.paymentAppQid) return settings.paymentAppQid;

  const result = await registerPaymentProvider(store, appUrl, { accessToken });
  return result.paymentAppQid;
}
