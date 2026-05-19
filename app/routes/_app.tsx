import { Outlet } from "react-router";
import { useEffect } from "react";
import { QumraAppBridgeProvider, useNavigationMenu } from "@qumra/jisr";
import { authenticate } from "~/qumra.server";
import { ensureIndexes } from "~/db.server";
import { ensurePaymentProviderRegistered } from "~/lib/payment-app-registration.server";

export async function loader({ request }: { request: Request }) {
  const authResponse = await authenticate.admin(request);

  if (authResponse instanceof Response) {
    return authResponse;
  }

  await ensureIndexes();

  let paymentAppQid: string | null = null;
  try {
    paymentAppQid = await ensurePaymentProviderRegistered(
      authResponse.store,
      process.env.QUMRA_APP_URL!,
      // Pass the installation's access token when available (preferred).
      // Falls back to HMAC-signed registration if undefined.
      (authResponse as { session?: { accessToken?: string } }).session
        ?.accessToken,
    );
  } catch (err) {
    console.error("[register] failed:", err);
  }

  return {
    apiKey: process.env.QUMRA_API_KEY || "",
    store: authResponse.store,
    paymentAppQid,
  };
}

function AppShell() {
  const navigation = useNavigationMenu();

  useEffect(() => {
    navigation.set([
      { label: "الرئيسية", url: "/", icon: "home" },
      { label: "الإعدادات", url: "/settings", icon: "settings" },
      { label: "المعاملات", url: "/transactions", icon: "orders" },
    ]);
  }, [navigation]);

  return <Outlet />;
}

export default function AppLayout({
  loaderData,
}: {
  loaderData: { apiKey: string; store: string; paymentAppQid: string | null };
}) {
  return (
    <QumraAppBridgeProvider config={{ apiKey: loaderData.apiKey }}>
      <AppShell />
    </QumraAppBridgeProvider>
  );
}
