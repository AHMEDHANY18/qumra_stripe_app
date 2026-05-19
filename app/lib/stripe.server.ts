import Stripe from "stripe";
import { getStoreSettings, type StoreSettings } from "~/db.server";

const ENV_FALLBACK = {
  secretKey: process.env.STRIPE_SECRET_KEY ?? "",
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
};

export async function getStripeConfigForStore(
  store: string,
): Promise<{
  stripe: Stripe;
  publishableKey: string;
  webhookSecret: string;
  settings: StoreSettings | null;
} | null> {
  const settings = await getStoreSettings().findOne({ store });

  const secretKey = settings?.stripeSecretKey || ENV_FALLBACK.secretKey;
  const publishableKey =
    settings?.stripePublishableKey || ENV_FALLBACK.publishableKey;
  const webhookSecret =
    settings?.stripeWebhookSecret || ENV_FALLBACK.webhookSecret;

  if (!secretKey) return null;

  const stripe = new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });

  return { stripe, publishableKey, webhookSecret, settings };
}

export async function getStripeConfigByPaymentAppQid(
  paymentAppQid: string,
): Promise<Awaited<ReturnType<typeof getStripeConfigForStore>>> {
  const settings = await getStoreSettings().findOne({ paymentAppQid });
  if (!settings) {
    if (!ENV_FALLBACK.secretKey) return null;
    const stripe = new Stripe(ENV_FALLBACK.secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
    return {
      stripe,
      publishableKey: ENV_FALLBACK.publishableKey,
      webhookSecret: ENV_FALLBACK.webhookSecret,
      settings: null,
    };
  }
  return getStripeConfigForStore(settings.store);
}

export interface CreateCheckoutInput {
  store: string;
  paymentAppQid: string;
  coreSessionQid: string;
  amount: number;
  currency: string;
  buyerReturnUrl: string;
  description?: string;
  customerEmail?: string;
}

export async function createCheckout(
  stripe: Stripe,
  input: CreateCheckoutInput,
  appUrl: string,
): Promise<Stripe.Checkout.Session> {
  const amountInMinorUnits = Math.round(input.amount * 100);
  const ulid = ulidOf(input.coreSessionQid);

  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: amountInMinorUnits,
          product_data: {
            name: input.description ?? `Order ${ulid}`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: input.customerEmail,
    success_url: `${appUrl}/return/${ulid}?status=success`,
    cancel_url: `${appUrl}/return/${ulid}?status=cancelled`,
    metadata: {
      coreSessionQid: input.coreSessionQid,
      coreSessionUlid: ulid,
      paymentAppQid: input.paymentAppQid,
      store: input.store,
    },
  });
}

export async function ensureWebhookEndpoint(
  stripe: Stripe,
  appUrl: string,
  paymentAppQid: string,
): Promise<{ id: string; secret: string }> {
  const webhookUrl = `${appUrl}/stripe/webhook/${encodeURIComponent(paymentAppQid)}`;
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = existing.data.find((w) => w.url === webhookUrl);
  if (found) {
    return { id: found.id, secret: found.secret ?? "" };
  }
  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: [
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "charge.refunded",
    ],
  });
  return { id: created.id, secret: created.secret ?? "" };
}

function ulidOf(qid: string): string {
  const parts = qid.split("/");
  return parts[parts.length - 1] || qid;
}
