import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/qumra.server";
import { getStoreSettings, getPaymentSessions } from "~/db.server";

/**
 * POST /webhooks/app-uninstalled
 *
 * Fired when the merchant uninstalls the app. We clear Stripe credentials
 * (but keep PaymentSession history for audit). core cleans up the
 * PaymentApp record on its side.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  if (session) {
    await getStoreSettings().updateOne(
      { store: shop },
      {
        $set: {
          stripeSecretKey: null,
          stripePublishableKey: null,
          stripeWebhookSecret: null,
          stripeWebhookId: null,
          configured: false,
          updatedAt: new Date(),
        },
      },
    );
    await getPaymentSessions().updateMany(
      { store: shop, status: "pending" },
      {
        $set: {
          status: "failed",
          failureReason: "app_uninstalled",
          updatedAt: new Date(),
        },
      },
    );
  }

  return Response.json({ success: true });
}
