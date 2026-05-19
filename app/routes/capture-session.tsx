import type { ActionFunctionArgs } from "react-router";
import { verifyCoreRequest } from "~/lib/verify-hmac-request";

/**
 * POST /capture-session
 *
 * Stripe Checkout in `mode: "payment"` auto-captures, so capture is a no-op
 * for our default config. To support manual capture, switch the Checkout
 * to `payment_intent_data.capture_method: "manual"` and call
 * `stripe.paymentIntents.capture(...)` here.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const verified = await verifyCoreRequest(request);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }
  return Response.json({ ok: true, note: "auto_captured_on_payment" });
}

export const loader = () =>
  Response.json({ error: "use_POST" }, { status: 405 });
