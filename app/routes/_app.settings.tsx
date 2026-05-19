import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Stripe from "stripe";
import { authenticate } from "~/qumra.server";
import { authenticateAction } from "~/lib/admin-auth.server";
import { getStoreSettings, ensureIndexes } from "~/db.server";
import { ensureWebhookEndpoint } from "~/lib/stripe.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  await ensureIndexes();

  const settings = await getStoreSettings().findOne({ store: auth.store });
  return {
    store: auth.store,
    paymentAppQid: settings?.paymentAppQid ?? null,
    secretKeyMasked: maskKey(settings?.stripeSecretKey),
    publishableKey: settings?.stripePublishableKey ?? "",
    webhookConfigured: Boolean(settings?.stripeWebhookSecret),
    testMode: settings?.testMode ?? true,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  // Don't use authenticate.admin here — its POST handler expects JSON+HMAC,
  // not form-urlencoded. Manually validate via Prisma session instead.
  const auth = await authenticateAction(request);

  const form = await request.formData();
  const secretKey = String(form.get("secretKey") ?? "").trim();
  const publishableKey = String(form.get("publishableKey") ?? "").trim();
  const testMode = form.get("testMode") === "on";

  if (!secretKey || !secretKey.startsWith("sk_")) {
    return { ok: false, error: "مفتاح Stripe السري غير صحيح" };
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
  let stripeAccountId: string | null = null;
  try {
    const account = await stripe.accounts.retrieve();
    stripeAccountId = account.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "خطأ في الاتصال";
    return { ok: false, error: `Stripe رفض المفتاح: ${msg}` };
  }

  const settings = await getStoreSettings().findOne({ store: auth.store });
  const paymentAppQid = settings?.paymentAppQid ?? null;

  let webhookId: string | null = settings?.stripeWebhookId ?? null;
  let webhookSecret: string | null = settings?.stripeWebhookSecret ?? null;
  if (paymentAppQid && process.env.QUMRA_APP_URL) {
    try {
      const wh = await ensureWebhookEndpoint(
        stripe,
        process.env.QUMRA_APP_URL,
        paymentAppQid,
      );
      webhookId = wh.id;
      webhookSecret = wh.secret || webhookSecret;
    } catch (err) {
      console.error("[settings] webhook setup failed:", err);
    }
  }

  await getStoreSettings().updateOne(
    { store: auth.store },
    {
      $set: {
        stripeSecretKey: secretKey,
        stripePublishableKey: publishableKey,
        stripeWebhookId: webhookId,
        stripeWebhookSecret: webhookSecret,
        stripeAccountId,
        configured: true,
        testMode,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        store: auth.store,
        paymentAppQid,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  return {
    ok: true,
    message: "تم حفظ الإعدادات بنجاح",
    stripeAccountId,
    webhookId,
  };
}

function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length < 12) return "••••••••";
  return `${key.slice(0, 7)}••••${key.slice(-4)}`;
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState(data.publishableKey);

  return (
    <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-gray-900">إعدادات Stripe</h1>
          <p className="text-gray-500">
            أدخل مفاتيح Stripe الخاصة بمتجرك. تُستخدم لإنشاء صفحات الدفع و التحقق من الـ webhooks.
          </p>
        </header>

        {result?.ok && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
            ✅ {result.message}
            {result.stripeAccountId && (
              <p className="mt-1 font-mono text-xs" dir="ltr">
                Stripe account: {result.stripeAccountId}
              </p>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
            ❌ {result.error}
          </div>
        )}

        <Form
          method="post"
          className="space-y-4 bg-white rounded-lg border border-gray-200 p-6"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Stripe Secret Key
            </label>
            <input
              type="password"
              name="secretKey"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={data.secretKeyMasked || "sk_test_..."}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono shadow-sm focus:border-blue-500 focus:outline-none"
              autoComplete="off"
              dir="ltr"
            />
            {data.secretKeyMasked && (
              <p className="mt-1 text-xs text-gray-500">
                المفتاح المحفوظ حالياً: <span dir="ltr">{data.secretKeyMasked}</span>. اتركه فارغاً للإبقاء عليه.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Stripe Publishable Key
            </label>
            <input
              type="text"
              name="publishableKey"
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_test_..."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono shadow-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="testMode"
              name="testMode"
              defaultChecked={data.testMode}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="testMode" className="text-sm text-gray-700">
              وضع الاختبار (Test mode)
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !secretKey}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {submitting ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </button>
        </Form>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">حالة الـ Webhook</h2>
          <p className="mt-1 text-sm text-gray-600">
            {data.webhookConfigured
              ? "✅ Webhook موصول. Stripe سوف يرسل تحديثات الدفع تلقائياً."
              : "⚠️ Webhook غير مُهيأ بعد. سيُنشأ تلقائياً عند حفظ المفتاح السري."}
          </p>
        </section>

        {data.paymentAppQid && (
          <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-xs">
            <div className="text-gray-500">Payment App ID:</div>
            <div className="text-gray-900 break-all" dir="ltr">
              {data.paymentAppQid}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
