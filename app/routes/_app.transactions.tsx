import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "~/qumra.server";
import { getPaymentSessions, ensureIndexes } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  await ensureIndexes();

  const sessions = await getPaymentSessions()
    .find({ store: auth.store })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return {
    sessions: sessions.map((s) => ({
      qid: s.coreSessionQid,
      ulid: s.coreSessionUlid,
      amount: s.amount,
      currency: s.currency,
      status: s.status,
      stripeId: s.stripeCheckoutSessionId,
      failureReason: s.failureReason,
      createdAt: s.createdAt?.toISOString() ?? null,
    })),
  };
}

export default function Transactions() {
  const { sessions } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">المعاملات</h1>
          <p className="text-gray-500">آخر 50 معاملة لهذا المتجر.</p>
        </header>

        {sessions.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            لا توجد معاملات بعد.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-start font-medium text-gray-700">Session</th>
                  <th className="px-4 py-2 text-start font-medium text-gray-700">المبلغ</th>
                  <th className="px-4 py-2 text-start font-medium text-gray-700">الحالة</th>
                  <th className="px-4 py-2 text-start font-medium text-gray-700">Stripe ID</th>
                  <th className="px-4 py-2 text-start font-medium text-gray-700">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map((s) => (
                  <tr key={s.qid}>
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">{s.ulid}</td>
                    <td className="px-4 py-2">
                      {s.amount.toFixed(2)} {s.currency}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500" dir="ltr">
                      {s.stripeId ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {s.createdAt ? new Date(s.createdAt).toLocaleString("ar-EG") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    succeeded: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-800",
    expired: "bg-gray-100 text-gray-700",
    refunded: "bg-indigo-100 text-indigo-800",
  };
  const labels: Record<string, string> = {
    pending: "قيد المعالجة",
    succeeded: "ناجحة",
    failed: "فاشلة",
    expired: "منتهية",
    refunded: "مستردّة",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
