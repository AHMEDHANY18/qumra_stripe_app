import type { ActionFunctionArgs } from "react-router";
import { verifyCoreRequest } from "~/lib/verify-hmac-request";
import { getStripeConfigByPaymentAppQid } from "~/lib/stripe.server";
import {
  getPaymentSessions,
  getRefunds,
  ensureIndexes,
} from "~/db.server";

/**
 * POST /refund-session
 *
 * Body in:  { sessionId, refundId?, amount?, currency?, reason? }
 * Body out: { ok: true, refund_id, status }
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
  const requestedAmount = body.amount !== undefined ? Number(body.amount) : null;

  if (!sessionId) {
    return Response.json({ error: "missing_sessionId" }, { status: 400 });
  }

  await ensureIndexes();

  const session = await getPaymentSessions().findOne({
    coreSessionQid: sessionId,
  });
  if (!session) {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }

  const stripeConfig = await getStripeConfigByPaymentAppQid(paymentAppQid);
  if (!stripeConfig) {
    return Response.json(
      { error: "stripe_not_configured" },
      { status: 503 },
    );
  }

  let paymentIntentId = session.stripePaymentIntentId;
  if (!paymentIntentId && session.stripeCheckoutSessionId) {
    const checkout = await stripeConfig.stripe.checkout.sessions.retrieve(
      session.stripeCheckoutSessionId,
    );
    if (typeof checkout.payment_intent === "string") {
      paymentIntentId = checkout.payment_intent;
      await getPaymentSessions().updateOne(
        { _id: session._id },
        { $set: { stripePaymentIntentId: paymentIntentId } },
      );
    }
  }

  if (!paymentIntentId) {
    return Response.json(
      { error: "no_payment_intent_to_refund" },
      { status: 409 },
    );
  }

  const refund = await stripeConfig.stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount:
      requestedAmount !== null
        ? Math.round(requestedAmount * 100)
        : undefined,
    reason: "requested_by_customer",
  });

  await getRefunds().insertOne({
    store: session.store,
    paymentAppQid,
    paymentSessionQid: sessionId,
    stripeRefundId: refund.id,
    amount: (refund.amount ?? 0) / 100,
    currency: (refund.currency ?? session.currency).toUpperCase(),
    status:
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed"
          ? "failed"
          : "pending",
    failureReason: refund.failure_reason ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await getPaymentSessions().updateOne(
    { coreSessionQid: sessionId },
    {
      $set: {
        status: refund.status === "succeeded" ? "refunded" : session.status,
        updatedAt: new Date(),
      },
      $push: {
        attempts: {
          at: new Date(),
          kind: "refund",
          status: refund.status === "failed" ? "failure" : "success",
          payload: { refundId: refund.id, amount: refund.amount },
        },
      },
    },
  );

  return Response.json({
    ok: true,
    refund_id: refund.id,
    status: refund.status,
  });
}

export const loader = () =>
  Response.json({ error: "use_POST" }, { status: 405 });
