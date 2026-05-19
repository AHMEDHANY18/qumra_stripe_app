import { Link, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "~/qumra.server";
import { getStoreSettings, getPaymentSessions, ensureIndexes } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  await ensureIndexes().catch(() => {});

  // Mongo may be unreachable in dev — fail soft so the dashboard still renders.
  let configured = false;
  let paymentAppQid: string | null = null;
  let counts = { pending: 0, succeeded: 0, failed: 0, refunded: 0 };
  let mongoError: string | null = null;

  try {
    const [settings, statusCounts] = await Promise.all([
      getStoreSettings().findOne({ store: auth.store }),
      getPaymentSessions()
        .aggregate<{ _id: string; count: number }>([
          { $match: { store: auth.store } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    configured = settings?.configured ?? false;
    paymentAppQid = settings?.paymentAppQid ?? null;
    const byStatus = Object.fromEntries(statusCounts.map((c) => [c._id, c.count]));
    counts = {
      pending: byStatus.pending ?? 0,
      succeeded: byStatus.succeeded ?? 0,
      failed: byStatus.failed ?? 0,
      refunded: byStatus.refunded ?? 0,
    };
  } catch (err) {
    mongoError = err instanceof Error ? err.message : String(err);
    console.error("[dashboard] mongo unreachable:", mongoError);
  }

  return { configured, paymentAppQid, counts, mongoError };
}

export default function Dashboard() {
  const { configured, paymentAppQid, counts, mongoError } =
    useLoaderData<typeof loader>();
  const search = useLocation().search; // preserves ?store=... across in-app nav

  return (
    <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Stripe Payment</h1>
          <p className="mt-1 text-gray-500">لوحة تحكم تطبيق الدفع.</p>
        </header>

        {mongoError && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 mb-6">
            <h2 className="font-semibold text-red-900">⚠️ MongoDB غير متاحة</h2>
            <p className="mt-1 text-sm text-red-800">
              التطبيق شغّال، لكن لا يستطيع قراءة بيانات المدفوعات. تحقق من <code dir="ltr">MONGODB_URL</code> في <code dir="ltr">.env</code>.
            </p>
            <p className="mt-2 text-xs font-mono text-red-700 break-all" dir="ltr">{mongoError}</p>
          </div>
        )}

        {!mongoError && !configured && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 mb-6">
            <h2 className="font-semibold text-amber-900">
              التطبيق غير مُهيأ بعد
            </h2>
            <p className="mt-1 text-amber-800">
              أدخل مفاتيح Stripe في صفحة{" "}
              <Link to={`/settings${search}`} className="underline font-semibold">
                الإعدادات
              </Link>{" "}
              لبدء استقبال المدفوعات.
            </p>
          </div>
        )}

        {configured && paymentAppQid && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 mb-6">
            <p className="text-emerald-900">
              ✅ التطبيق مُسجّل كمزود دفع لدى Qumra core.
            </p>
            <p className="mt-1 font-mono text-xs text-emerald-700 break-all" dir="ltr">
              {paymentAppQid}
            </p>
          </div>
        )}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-6">
          <Stat label="قيد المعالجة" value={counts.pending} tone="amber" />
          <Stat label="ناجحة" value={counts.succeeded} tone="emerald" />
          <Stat label="فاشلة" value={counts.failed} tone="red" />
          <Stat label="مستردّة" value={counts.refunded} tone="indigo" />
        </section>

        <section className="flex gap-3">
          <Link
            to={`/transactions${search}`}
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            عرض المعاملات
          </Link>
          <Link
            to={`/settings${search}`}
            className="inline-block rounded-md bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300"
          >
            الإعدادات
          </Link>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "emerald" | "red" | "indigo";
}) {
  const palette: Record<typeof tone, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
  };
  return (
    <div className={`rounded-lg border p-4 ${palette[tone]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm">{label}</div>
    </div>
  );
}
