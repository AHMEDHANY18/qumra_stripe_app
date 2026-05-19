import type { ActionFunctionArgs } from "react-router";
import { verifyCoreRequest } from "~/lib/verify-hmac-request";
import {
  getStripeConfigByPaymentAppQid,
  createCheckout,
} from "~/lib/stripe.server";
import {
  getPaymentSessions,
  getStoreSettings,
  ensureIndexes,
} from "~/db.server";

/**
 * POST /payment-session
 *
 * Called by Qumra core (HMAC-signed) to start a new payment session.
 * Contract (core-service/src/cores/payment-app-service/
 *           services/create-payment-session.service.ts):
 *
 *   Body in:  { sessionId, amount, currency, buyerReturnUrl, order?: {id} }
 *   Body out: { redirect_url, provider_reference, expires_at? }
 *
 * Response keys are **snake_case** — camelCase is rejected by core.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const verified = await verifyCoreRequest(request);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }

  const { body, paymentAppQid } = verified.data;
  const sessionId = String(body.sessionId ?? "");
  const amount = Number(body.amount);
  const currency = String(body.currency ?? "").toUpperCase();
  const buyerReturnUrl = String(body.buyerReturnUrl ?? "");

  if (!sessionId || !amount || !currency || !buyerReturnUrl) {
    return Response.json(
      { error: "missing_required_fields" },
      { status: 400 },
    );
  }

  await ensureIndexes();

  const settings = await getStoreSettings().findOne({ paymentAppQid });
  const store = settings?.store ?? "default.qumra.store";

  const stripeConfig = await getStripeConfigByPaymentAppQid(paymentAppQid);
  if (!stripeConfig) {
    return Response.json(
      { error: "stripe_not_configured" },
      { status: 503 },
    );
  }

  const checkout = await createCheckout(
    stripeConfig.stripe,
    {
      store,
      paymentAppQid,
      coreSessionQid: sessionId,
      amount,
      currency,
      buyerReturnUrl,
      description: `Payment for ${sessionId}`,
    },
    process.env.QUMRA_APP_URL!,
  );

  const coreSessionUlid = sessionId.split("/").pop() ?? sessionId;

  await getPaymentSessions().updateOne(
    { coreSessionQid: sessionId },
    {
      $set: {
        store,
        paymentAppQid,
        coreSessionQid: sessionId,
        coreSessionUlid,
        amount,
        currency,
        status: "pending",
        stripeCheckoutSessionId: checkout.id,
        stripePaymentIntentId:
          typeof checkout.payment_intent === "string"
            ? checkout.payment_intent
            : null,
        buyerReturnUrl,
        providerReference: checkout.id,
        failureReason: null,
        attempts: [
          {
            at: new Date(),
            kind: "create",
            status: "success",
            payload: { checkoutId: checkout.id },
          },
        ],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  const expiresAt = new Date(
    checkout.expires_at
      ? checkout.expires_at * 1000
      : Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();

  return Response.json({
    redirect_url: checkout.url,
    provider_reference: checkout.id,
    expires_at: expiresAt,
  });
}

export const loader = () =>
  Response.json({ error: "use_POST" }, { status: 405 });
