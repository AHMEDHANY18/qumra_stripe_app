import type { ActionFunctionArgs } from "react-router";
import { verifyCoreRequest } from "~/lib/verify-hmac-request";

/**
 * POST /void-session
 *
 * Voids only apply to authorized-but-not-captured PaymentIntents. Stripe
 * Checkout auto-captures in our default config, so this returns ok.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const verified = await verifyCoreRequest(request);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }
  return Response.json({
    ok: true,
    note: "void_not_supported_in_auto_capture_mode",
  });
}

export const loader = () =>
  Response.json({ error: "use_POST" }, { status: 405 });
