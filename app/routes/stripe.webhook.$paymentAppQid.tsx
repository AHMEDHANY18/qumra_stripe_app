import type { ActionFunctionArgs } from "react-router";
import type Stripe from "stripe";
import { getStripeConfigByPaymentAppQid } from "~/lib/stripe.server";
import { getPaymentSessions, ensureIndexes } from "~/db.server";
import {
  resolveSession,
  rejectSession,
} from "~/lib/core-callback";

/**
 * POST /stripe/webhook/:paymentAppQid
 *
 * Stripe → us → Qumra core. The buyer's browser may or may not have
 * returned yet — core is the source of truth either way.
 *
 * `paymentAppQid` is URL-encoded to carry the `qid://...` slashes safely.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const paymentAppQid = decodeURIComponent(params.paymentAppQid ?? "");
  if (!paymentAppQid) {
    return Response.json({ error: "missing_qid" }, { status: 400 });
  }

  const stripeConfig = await getStripeConfigByPaymentAppQid(paymentAppQid);
  if (!stripeConfig) {
    return Response.json({ error: "unknown_tenant" }, { status: 404 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripeConfig.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      stripeConfig.webhookSecret,
    );
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return Response.json(
      { error: "invalid_signature" },
      { status: 400 },
    );
  }

  await ensureIndexes();

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleSuccess(event, paymentAppQid);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await handleFailure(event, paymentAppQid);
        break;
      case "charge.refunded":
        // Already reflected by /refund-session; no-op.
        break;
    }
  } catch (err) {
    console.error(
      `[stripe-webhook] failed to handle ${event.type}:`,
      err,
    );
  }

  return Response.json({ received: true });
}

async function handleSuccess(event: Stripe.Event, paymentAppQid: string) {
  const checkout = event.data.object as Stripe.Checkout.Session;
  const coreSessionQid =
    (checkout.metadata?.coreSessionQid as string) ?? null;
  if (!coreSessionQid) {
    console.warn(
      `[stripe-webhook] success event with no coreSessionQid metadata: ${checkout.id}`,
    );
    return;
  }

  const paymentIntent =
    typeof checkout.payment_intent === "string"
      ? checkout.payment_intent
      : (checkout.payment_intent?.id ?? null);

  await getPaymentSessions().updateOne(
    { coreSessionQid },
    {
      $set: {
        status: "succeeded",
        stripePaymentIntentId: paymentIntent,
        updatedAt: new Date(),
      },
      $push: {
        attempts: {
          at: new Date(),
          kind: "stripe.success",
          status: "success",
          payload: { eventType: event.type, paymentIntent },
        },
      },
    },
  );

  await resolveSession(coreSessionQid, paymentAppQid, {
    providerReference: checkout.id,
    amount: (checkout.amount_total ?? 0) / 100,
    currency: (checkout.currency ?? "usd").toUpperCase(),
    paidAt: new Date(event.created * 1000).toISOString(),
  });
}

async function handleFailure(event: Stripe.Event, paymentAppQid: string) {
  const checkout = event.data.object as Stripe.Checkout.Session;
  const coreSessionQid =
    (checkout.metadata?.coreSessionQid as string) ?? null;
  if (!coreSessionQid) return;

  const reason =
    event.type === "checkout.session.expired"
      ? "checkout_expired"
      : "payment_failed";

  await getPaymentSessions().updateOne(
    { coreSessionQid },
    {
      $set: {
        status: event.type === "checkout.session.expired" ? "expired" : "failed",
        failureReason: reason,
        updatedAt: new Date(),
      },
      $push: {
        attempts: {
          at: new Date(),
          kind: "stripe.failure",
          status: "failure",
          payload: { eventType: event.type, reason },
        },
      },
    },
  );

  await rejectSession(coreSessionQid, paymentAppQid, {
    providerReference: checkout.id,
    reason,
  });
}
