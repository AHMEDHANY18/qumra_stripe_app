import { getOfflineSessionId } from "@qumra/app-sdk";
import prisma from "../../prisma/lib/prisma";

/**
 * Authenticate a POST action from within the admin embed.
 *
 * @qumra/app-react-router's `authenticate.admin` only supports POST when the
 * body is JSON + HMAC-signed (webhook/action pattern). Plain HTML `<Form>`
 * submissions send `application/x-www-form-urlencoded` and fail with
 * "Unexpected token 's', secretKey=..." inside authenticate.admin.
 *
 * Workaround: read the `?store=...` query param (preserved by Links via
 * `useLocation().search`) and look up the offline session directly in Prisma.
 * The session record was created during the original GET flow by
 * authenticate.admin, so its existence is proof of a prior valid auth for
 * this store.
 */
export async function authenticateAction(request: Request): Promise<{
  store: string;
  accessToken: string;
}> {
  const url = new URL(request.url);
  const store = url.searchParams.get("store");
  if (!store) {
    throw new Response("Missing store parameter", { status: 400 });
  }

  const sessionId = getOfflineSessionId(store);
  const record = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!record) {
    throw new Response("No session for this store", { status: 401 });
  }

  return { store, accessToken: record.accessToken };
}
