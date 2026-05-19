import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentSessions, ensureIndexes } from "~/db.server";
import { getSession } from "~/lib/core-callback";

/**
 * GET /return/:sessionUlid
 *
 * Where Stripe drops the buyer after Checkout. If the webhook has already
 * arrived, we 302 to the buyer's return URL. Otherwise we show a small
 * "verifying" page that auto-refreshes every 2 seconds.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const sessionUlid = params.sessionQid ?? "";
  if (!sessionUlid) {
    throw new Response("Missing session id", { status: 400 });
  }

  await ensureIndexes();

  const session = await getPaymentSessions().findOne({
    coreSessionUlid: sessionUlid,
  });

  const url = new URL(request.url);
  const stripeStatus = url.searchParams.get("status") ?? "unknown";

  if (stripeStatus === "cancelled" && session?.buyerReturnUrl) {
    return redirect(
      appendQuery(session.buyerReturnUrl, {
        status: "cancelled",
        session: session.coreSessionQid,
      }),
    );
  }

  if (
    session?.status === "succeeded" ||
    session?.status === "failed" ||
    session?.status === "refunded"
  ) {
    return redirect(
      appendQuery(session.buyerReturnUrl, {
        status: session.status === "succeeded" ? "paid" : "failed",
        session: session.coreSessionQid,
      }),
    );
  }

  if (session) {
    const coreState = await getSession(session.coreSessionQid).catch(() => null);
    const redirectUrl = coreState?.nextAction?.redirectUrl;
    if (redirectUrl) return redirect(redirectUrl);
  }

  return {
    sessionUlid,
    coreSessionQid: session?.coreSessionQid ?? null,
    fallbackReturnUrl: session?.buyerReturnUrl ?? null,
  };
}

function appendQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${url}${sep}${qs}`;
}

export default function ReturnPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <title>جاري التحقق من الدفع...</title>
        <meta httpEquiv="refresh" content="2" />
        <style>{`
          body { font-family: system-ui, sans-serif; padding: 4rem 1rem; text-align: center; background: #f9fafb; color: #1f2937; }
          .spinner { width: 48px; height: 48px; border: 4px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; margin: 0 auto 1.5rem; animation: spin 0.8s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          a { color: #3b82f6; }
        `}</style>
      </head>
      <body>
        <div className="spinner" />
        <h1>جاري التحقق من الدفع...</h1>
        <p>برجاء الانتظار، هذه الصفحة سوف تتحدث تلقائياً.</p>
        {data.fallbackReturnUrl && (
          <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
            استغرق وقت أطول من المتوقع؟{" "}
            <a href={data.fallbackReturnUrl}>ارجع للمتجر</a>
          </p>
        )}
      </body>
    </html>
  );
}
