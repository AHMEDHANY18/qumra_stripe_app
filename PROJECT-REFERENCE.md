# Qumra Stripe Payment App — المرجع الشامل

> **الغرض:** ملف واحد يفهم منه أي Claude (أو Dev) في سيشن جديدة المشروع ده كامل من غير ما يقرأ كل الكود.
> اقرأه من فوق لتحت أول مرة، بعدها اقفز للقسم اللي تحتاجه.
>
> **آخر تحديث:** 2026-05-25 · **التوافق:** الكود الحالي + ربط الـ orders في core تم (2026-05-25)
> **المسارات:**  Windows: `C:\PC\qumra app\stripe\` · WSL: `/mnt/c/PC/qumra app/stripe/`

> ملفات مرافقة في نفس الفولدر: `CLAUDE.md` (notes قديمة من sessions سابقة، أحدث منها هذا الملف) · `README.md` · `IMPLEMENTATION.md`.

---

## 1) TL;DR في ٣ سطور

- **إيه التطبيق:** Bridge بين **Qumra core** (متجر العميل) و **Stripe** (مزوّد الدفع). core ما بيعرفش Stripe، Stripe ما بيعرفش core — التطبيق ده هو المترجم بالـ HMAC من ناحية والـ Stripe SDK من الناحية التانية.
- **الـ stack:** React Router 7 SSR + TypeScript strict + Prisma/SQLite (لجلسات Qumra) + MongoDB (لبيانات الدفع) + Stripe SDK v17 + Tailwind v4 + `@qumra/jisr` للـ embed bridge.
- **الحالة:** الكود مكتمل. تم ربطه بالـ orders في `core-service` (2026-05-25 — تفاصيل في `core-service/STRIPE-ORDER-INTEGRATION.md`). الباقي: اختبار E2E بعد تثبيت التطبيق على المتجر التجريبي وإدخال مفاتيح Stripe.

---

## 2) عن المستخدم (مهم)

- 🇪🇬 عربي مصري، beginner-to-intermediate في تطبيقات Qumra.
- بيتواصل بالعربية المصرية ويفضّل step-by-step.
- بيشتغل من Windows. Claude بيتشغّل من WSL ويوصل عبر `/mnt/c/...`.
- بيفضّل التنفيذ التلقائي (ما يسألش أسئلة كتير، ينفّذ ويلخّص).
- ❌ **متحطش node projects في OneDrive** — npm install بيفشل بـ EPERM/ECONNRESET. التطبيق ده في `C:\PC\` متعمّد.
- ✅ الذاكرة الدائمة بتاعة Claude بتفتح تلقائيًا في كل سيشن (شوف `MEMORY.md` في `.claude/projects/...`).

---

## 3) الصورة الكبيرة (architecture)

```
   ┌──────────────────┐       ┌──────────────────────┐       ┌──────────────┐
   │   Qumra core      │──HMAC▶│   تطبيق Stripe ده     │──API─▶│   Stripe     │
   │ (localhost:4006)  │◀─HMAC│  (cloudflared tunnel) │◀ wh ─│              │
   └──────────────────┘       └──────────────────────┘       └──────────────┘
            │                            │
            │                            ▼
            │                  ┌──────────────────┐
            │                  │ MongoDB Atlas    │  bytecode of payment data
            │                  └──────────────────┘
            ▼                            ▲
   ┌──────────────────┐                  │
   │  متجر العميل (   │                  │
   │  storefront)     │──────redirect────┘
   └──────────────────┘
```

- **core** ما يعرفش Stripe — بينادي تطبيقات الدفع بـ HMAC.
- **التطبيق** بيسجل نفسه عند core كـ payment provider بعد install.
- **core → التطبيق:** POST موقّع HMAC على ٤ endpoints (`payment-session` / `refund-session` / `capture-session` / `void-session`).
- **التطبيق → Stripe:** يفتح Stripe Checkout، يحفظ السر في Mongo.
- **Stripe → التطبيق:** webhook لما الدفعة تنجح/تفشل.
- **التطبيق → core:** يبلّغ النتيجة بـ HMAC (`resolve`/`reject`/`pending`).
- **core (بعد 2026-05-25):** يسوّي الأوردر (paid) وبيرجّع العميل لصفحة الشكر.

---

## 4) الـ Tech Stack

| الطبقة | الاختيار | ملاحظات |
|---|---|---|
| Framework | **React Router 7** (SSR mode) | `react-router.config.ts` + `app/routes/` filesystem routing |
| TypeScript | strict, target ES2022 | `tsconfig.json` — `npx tsc --noEmit` نضيف |
| UI | Tailwind v4 (`@tailwindcss/vite`) + RTL + Cairo font | داخل `app/app.css` / صفحات `_app.*` |
| Embed bridge | `@qumra/jisr` — `QumraAppBridgeProvider`, `useNavigationMenu`, `useToast`, `useSaveBar`, `useAppBridge` | للـ admin UI داخل iframe |
| Qumra auth | `@qumra/app-react-router` — `qumraApp()` factory | في `app/qumra.server.ts` |
| Qumra session storage | **Prisma + SQLite** (`@qumra/app-session-storage-prisma`) | ملف `prisma/dev.db` (git-ignored) |
| Payment business data | **MongoDB Atlas** (مستقل عن جلسات Qumra) | DB: `qumra_stripe_app` |
| Payment provider | `stripe` v17 (server SDK + Stripe Checkout mode) | `apiVersion: "2025-02-24.acacia"` |
| Dev tunnel | cloudflared (مُدار بواسطة `qumra app dev`) | URL بيتغيّر كل restart |
| Bundler | Vite 7 + `@react-router/dev` | `allowedHosts: true` بسبب tunnel |
| Node | **24+ مطلوب** | بيستخدم `node:sqlite` built-in module |

```json
// package.json scripts (الموجود فعلاً)
"build": "react-router build",
"dev": "qumra app dev",
"start": "react-router-serve ./build/server/index.js",
"typecheck": "react-router typegen && tsc"
```

---

## 5) Project IDs و Credentials

```
clientId      : bee542d6-8338-42c8-bf3d-c50b3366a15a   (.qumra/qumra.config.json — managed by CLI)
devStore      : 54ygbeof.qumra.store                   (.qumra/qumra.config.json)
Org / App     : stripe / stripe
Install URL   : https://app.qumra.cloud/store/54ygbeof/apps/stripe
```

**MongoDB Atlas** (الـ cluster مشترك مع core، DB منفصل):
- Cluster: `cluster0.1gdx53y.mongodb.net`
- User: `qumra` / pass: `qumra-pass`
- DB: `qumra_stripe_app` (مختلف عن DB بتاع core)
- Replica set: `atlas-j0xh3g-shard-0`
- **استخدم standard non-SRV URL** (الشبكة بترفض SRV records — راجع gotcha 9.4)

**Stripe TEST mode** (المفاتيح في `.env` — مش في git):
- `STRIPE_SECRET_KEY=sk_test_…` ✅ موجود
- `STRIPE_WEBHOOK_SECRET=whsec_…` ✅ موجود
- `STRIPE_PUBLISHABLE_KEY=…` ⚠️ placeholder — لازم نجيبها من dashboard.stripe.com/test/apikeys لما تتطلب

**كارت اختبار:** `4242 4242 4242 4242` · أي تاريخ مستقبلي · أي CVC.

---

## 6) عقد الـ HMAC (لا تخمّن — هنا التفاصيل الدقيقة)

### الـ Headers (كل النداءات في الاتجاهين)
| Header | المحتوى |
|---|---|
| `X-Qumra-Topic` | اسم العملية بالـ dots (مثلاً `payment.session.create`) |
| `X-Qumra-Hmac-Sha256` | `base64(HMAC-SHA256(rawBody, App.secretKey))` — على الـ **raw body** قبل أي `JSON.parse` |
| `X-Qumra-App-Client-Id` | clientId بتاع التطبيق |
| `X-Qumra-Payment-App-Qid` | qid الـ PaymentApp في core (مثلاً `qid://qumra/PaymentApp/01H…`) |
| `X-Qumra-Timestamp` | ISO-8601، **tolerance ±5 دقايق** (anti-replay) |

### الـ Topics
| الاتجاه | Topic | Endpoint |
|---|---|---|
| core → us | `payment.session.create` | `POST /payment-session` |
| core → us | `payment.refund.create` (مستقبل) | `POST /refund-session` |
| core → us | `payment.capture.create` (مستقبل) | `POST /capture-session` |
| core → us | `payment.void.create` (مستقبل) | `POST /void-session` |
| us → core | `payment.session.resolve` | `POST /v1/payment-sessions/:ulid/resolve` |
| us → core | `payment.session.reject` | `POST /v1/payment-sessions/:ulid/reject` |
| us → core | `payment.session.pending` | `POST /v1/payment-sessions/:ulid/pending` |

### قواعد ذهبية
1. **التوقيع على الـ raw body** قبل الـ parse. تـ `JSON.parse` أولاً = التوقيع يفسد.
2. **رد التطبيق على `payment.session.create` لازم snake_case**: `{ redirect_url, provider_reference, expires_at? }`. camelCase → core بترفض بـ `INVALID_PROVIDER_RESPONSE`.
3. **رد التطبيق على resolve للـ core (camelCase)**: `{ providerReference, amount, currency, paidAt }`.
4. **الـ sessionId** اللي core بيبعت = `qid://qumra/PaymentSession/01HX…`. لما تـ POST لـ core، الـ URL path يستخدم **الـ ULID فقط** (مش الـ qid كامل) — في `app/lib/core-callback.ts:11` فيه `ulidOf()`.
5. **مصدر الحقيقة:** server-to-server callback بعد Stripe webhook → core. متصفح المشتري **مش** مصدر الحقيقة.
6. **الـ secret:** `App.secretKey` في core = `QUMRA_API_SECRET` env var في التطبيق (`qumra app dev` بيحقنها). الطرفين يوقّعوا ويتحققوا بنفس المفتاح.
7. **Dev bypass:** `DEV_MOCK_BYPASS_TOKEN` في `.env`؛ لو الـ header `X-Dev-Mock-Bypass` بيطابقه، الـ HMAC verification بيتسكّت (للـ smoke tests بـ curl). في production معطّل تلقائيًا (`NODE_ENV === 'production'`).

---

## 7) الـ Auth Flow (جانب Qumra)

`authenticate.admin(request)` من `@qumra/app-react-router`:

- **GET requests:** بتقرأ `?store=<sub>.qumra.store` من URL query. لو missing → `QumraAuthError("Missing store parameter")`.
- **POST requests:** بتعتمد على headers الـ HMAC (webhook/action pattern — تعتبر الـ body **JSON موقّع**).
- **مفيش cookie fallback** — كل request محتاج `store` في الـ URL.

### نتائج عملية
- أي `<Link>` لـ admin route لازم يحافظ على search params:
  ```tsx
  import { Link, useLocation } from "react-router";
  const search = useLocation().search;
  <Link to={`/settings${search}`}>...</Link>
  ```
- أي `<Form method="post">` بيبعت `application/x-www-form-urlencoded` → `authenticate.admin` بتكسر JSON.parse. **الحل المعمول:** helper `authenticateAction()` في `app/lib/admin-auth.server.ts` — للـ POST actions في الـ admin UI، استخدم ده مش `authenticate.admin`.

---

## 8) خريطة الملفات (file map)

### الـ Config
| الملف | المحتوى | تعديل يدوي؟ |
|---|---|---|
| `.qumra/qumra.config.json` | `clientId` + `devStore` — مُدار بالـ CLI | ❌ لا |
| `qumra.app.json` | scopes + webhooks + productionUrl — synced live | ✅ نعم |
| `.env` | secrets (Stripe + Mongo + DEV_MOCK_BYPASS_TOKEN) | ✅ مش في git |
| `package.json` | deps + scripts | ✅ |
| `vite.config.ts` | `allowedHosts: true` (cloudflared tunnels تتغير) | ✅ |
| `react-router.config.ts` | إعدادات الـ framework | ✅ |
| `prisma/schema.prisma` | model `Session` فقط (Qumra sessions) | ✅ |

**qumra.app.json الحالي:**
```json
{
  "scopes": ["orders:read", "orders:write", "store:read"],
  "webhooks": {
    "api_version": "v1",
    "subscriptions": [
      { "topics": ["app/uninstalled"], "uri": "/webhooks/app-uninstalled" }
    ]
  },
  "productionUrl": ""
}
```
ملاحظة: `payment` extension **ما اتعلنش هنا**؛ بدل ده، التطبيق بيسجّل نفسه ديناميكيًا في `_app.tsx` loader عبر `/v1/payment-apps/from-installation`.

### الـ App code (`app/`)
| الملف | الوظيفة | كود مهم |
|---|---|---|
| `qumra.server.ts` | `qumraApp({ apiKey, secretKey, sessionStorage: PrismaSessionStorage })` — entry للـ Qumra auth | injects `QUMRA_API_KEY`/`QUMRA_API_SECRET` |
| `db.server.ts` | MongoDB lazy client + 3 collections | `getStoreSettings()` / `getPaymentSessions()` / `getRefunds()` / `ensureIndexes()` |
| `lib/hmac.ts` | `signRawBody` / `verifyRawBody` | base64 HMAC-SHA256 + `timingSafeEqual` |
| `lib/verify-hmac-request.ts` | inbound HMAC verifier (core → us) | يقرأ rawBody، يتحقق من timestamp ±5min، يدعم bypass token |
| `lib/core-callback.ts` | outbound callbacks (us → core) | `resolveSession` / `rejectSession` / `pendingSession` / `getSession` + `ulidOf` |
| `lib/stripe.server.ts` | Stripe client + checkout + webhook ensure | `getStripeConfigForStore` / `getStripeConfigByPaymentAppQid` / `createCheckout` / `ensureWebhookEndpoint` |
| `lib/payment-app-registration.server.ts` | تسجيل التطبيق في core | `registerPaymentProvider` / `ensurePaymentProviderRegistered` (idempotent) |
| `lib/admin-auth.server.ts` | helper للـ POST actions في الـ admin (يقرأ `?store=...` ويـ load session من Prisma) | بديل `authenticate.admin` للـ form POSTs |

### الـ Routes (`app/routes/`)
| Route | Method | الـ caller | الوظيفة |
|---|---|---|---|
| `_app.tsx` | GET | المتصفّح (admin iframe) | parent layout — auth + auto-register + nav menu |
| `_app._index.tsx` | GET | المتصفّح | Dashboard (stats + status banners) |
| `_app.settings.tsx` | GET / POST | المتصفّح (التاجر) | form لمفاتيح Stripe + auto-create webhook |
| `_app.transactions.tsx` | GET | المتصفّح | آخر ٥٠ payment session |
| `auth.$.tsx` | GET | OAuth callback | بيوصّل `authenticate.admin` |
| `payment-session.tsx` | POST | core (HMAC) | إنشاء Stripe Checkout |
| `refund-session.tsx` | POST | core (HMAC) | استرجاع عبر Stripe |
| `capture-session.tsx` | POST | core (HMAC) | stub (Stripe Checkout بيـ capture تلقائيًا) |
| `void-session.tsx` | POST | core (HMAC) | stub |
| `stripe.webhook.$paymentAppQid.tsx` | POST | Stripe | استقبال أحداث Stripe → notify core |
| `return.$sessionQid.tsx` | GET | متصفّح المشتري | الرجوع بعد الدفع — polling لو webhook ما وصلش |
| `webhooks.app-uninstalled.tsx` | POST | core (HMAC) | مسح credentials لما يلغي التثبيت |

---

## 9) التدفّق الكامل End-to-End

### 9.1 التثبيت (Install — مرة واحدة)
1. التاجر يفتح App Store على `54ygbeof.qumra.store` → Install على Stripe.
2. OAuth flow يكتمل → التطبيق يلود في iframe بـ `?store=<sub>.qumra.store&id_token=<jwt>&...`.
3. **`_app.tsx` loader**:
   - `authenticate.admin(request)` → يخزّن session في Prisma SQLite.
   - `ensurePaymentProviderRegistered(store, QUMRA_APP_URL, accessToken?)` → يـ POST لـ `core/v1/payment-apps/from-installation`.
   - يخزّن `paymentAppQid` في Mongo `store_settings`.

**Body اللي بيتبعت لـ core في التسجيل:**
```json
{
  "urls": {
    "paymentSession": "{appUrl}/payment-session",
    "refundSession": "{appUrl}/refund-session",
    "captureSession": "{appUrl}/capture-session",
    "voidSession": "{appUrl}/void-session"
  },
  "supportedCurrencies": ["USD","SAR","EGP","AED","EUR","GBP"],
  "displayName": "Stripe Payment by Qumra",
  "description": "Credit cards, Apple Pay, Google Pay via Stripe Checkout",
  "setPrimary": true
}
```
**Auth:** Bearer access token لو متاح، fallback HMAC في dev.

### 9.2 الإعداد (Configure — مرة واحدة)
4. التاجر يفتح `/settings` (مع preserve لـ `?store=...`).
5. يدخل `sk_test_...` (+ اختياري `pk_test_...`).
6. **`_app.settings.tsx` action**:
   - يـ validate المفتاح بـ `stripe.accounts.retrieve()`.
   - `ensureWebhookEndpoint(stripe, appUrl, paymentAppQid)` — ينشئ webhook على Stripe بـ URL: `{tunnel}/stripe/webhook/{encodeURIComponent(paymentAppQid)}` ويـ subscribe للـ events: `checkout.session.completed`, `expired`, `async_payment_succeeded`, `async_payment_failed`, `charge.refunded`.
   - يحفظ كل ده في Mongo `store_settings` (سر الـ webhook + الـ ID).

### 9.3 الـ Checkout (لما المشتري يدفع)
7. **العميل في صفحة الـ checkout** يختار Stripe (تطبيق Stripe دلوقتي بيظهر في قائمة الدفع بفضل ربط 2026-05-25 في core — راجع `core-service/STRIPE-ORDER-INTEGRATION.md`).
8. **core** يـ POST `/v1/payment-apps/sessions` (internal entry) → ينشئ `PaymentSession` (status=pending, order=…).
9. **core → التطبيق** (HMAC) `POST {appUrl}/payment-session` بـ topic `payment.session.create`:
   ```json
   {
     "sessionId": "qid://qumra/PaymentSession/01HX…",
     "amount": 250,
     "currency": "SAR",
     "buyerReturnUrl": "https://store/customer/thank-you/1042",
     "order": { "id": "<orderId>" }
   }
   ```
10. **التطبيق** (`app/routes/payment-session.tsx`):
    - `verifyCoreRequest(request)` يتحقق من الـ HMAC + timestamp + يـ parse الـ body بعد التحقق.
    - يقرأ `paymentAppQid` من header.
    - `getStripeConfigByPaymentAppQid(paymentAppQid)` يجيب الـ Stripe client للتاجر.
    - `createCheckout()` (في `stripe.server.ts`) — يحوّل المبلغ ×100 (سنت)، success_url = `{appUrl}/return/{ULID}?status=success`، cancel_url = نفس الشكل بـ `cancelled`، metadata = `{ coreSessionQid, coreSessionUlid, paymentAppQid, store }`.
    - upsert في `payment_sessions` بـ status=pending.
    - **يرجّع snake_case:**
      ```json
      { "redirect_url": "https://checkout.stripe.com/c/…", "provider_reference": "cs_test_…", "expires_at": "2026-…" }
      ```
11. **core** يحفظ الـ `providerRedirectUrl` + `providerReference` ويرجّع للـ order flow.
12. **CreateOrderHelper في core** يرجّع `redirectUrl` للستورفرونت → المشتري يتحوّل.

### 9.4 الدفع (الـ Webhook = مصدر الحقيقة)
13. المشتري يدفع على Stripe.
14. **Stripe → التطبيق** (`/stripe/webhook/{paymentAppQid}`):
    - `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` يتحقق من توقيع Stripe.
    - حسب `event.type`:
      - `checkout.session.completed` / `async_payment_succeeded` → `handleSuccess()`:
        - يقرأ `coreSessionQid` من metadata.
        - يحدّث `payment_sessions` لـ status=succeeded.
        - `resolveSession(coreSessionQid, paymentAppQid, { providerReference, amount, currency, paidAt })` → `POST core/v1/payment-sessions/{ULID}/resolve` (HMAC).
      - `checkout.session.expired` / `async_payment_failed` → `handleFailure()` → `rejectSession(...)`.
      - `charge.refunded` → no-op (متعلّق بالـ refund-session).
15. **core (بعد ربط 2026-05-25):**
    - يحوّل `PaymentSession.status = resolved`.
    - يبني `nextActionRedirectUrl = buyerReturnUrl?status=paid&session={qid}`.
    - **`SettleOrderPaymentService.markPaid(session.order, paidAt)`** يعلّم الأوردر `financialStatus=paid`, `isPaid=true`, `paidAt`.
    - يرد على التطبيق بـ `{ nextAction: { redirectUrl } }`.

### 9.5 رجوع المشتري
16. Stripe success_url يحوّل المشتري على `{appUrl}/return/{ULID}?status=success`.
17. **`return.$sessionQid.tsx` loader**:
    - يلاقي الـ session في Mongo بـ `coreSessionUlid`.
    - لو `?status=cancelled` → redirect لـ `buyerReturnUrl?status=cancelled`.
    - لو session.status `succeeded`/`failed`/`refunded` → redirect لـ `buyerReturnUrl?status=paid|failed`.
    - لو webhook ما وصلش لسه → يستفسر core (`getSession`) لـ `nextAction.redirectUrl`.
    - لو لسه pending → يعرض صفحة "جاري التحقق..." بـ `<meta httpEquiv="refresh" content="2" />`.

### 9.6 الـ Refund (مستقبل)
18. التاجر يضغط Refund في core admin → `POST /refund-session` للتطبيق (HMAC).
19. التطبيق يـ `stripe.refunds.create({ payment_intent })` ويحفظ refund record في `refunds`.
20. الـ webhook `charge.refunded` يوصل لكن no-op (الـ refund-session هو اللي بيحدّث).

---

## 10) جداول قاعدة البيانات

### MongoDB (`qumra_stripe_app`)

#### `store_settings` (واحد لكل متجر)
```ts
{
  store: string;                  // "<sub>.qumra.store" — scoping key (unique)
  paymentAppQid: string | null;   // ID من core بعد التسجيل
  stripeSecretKey: string | null; // ⚠️ TODO: encrypt at rest
  stripePublishableKey: string | null;
  stripeWebhookSecret: string | null;
  stripeWebhookId: string | null;
  stripeAccountId: string | null;
  configured: boolean;            // true بعد ما التاجر يحفظ مفاتيح Stripe
  testMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}
// Indexes: { store } unique, { paymentAppQid } sparse
```

#### `payment_sessions` (واحد لكل عملية دفع)
```ts
{
  store: string;
  paymentAppQid: string;
  coreSessionQid: string;         // qid:// كامل (unique)
  coreSessionUlid: string;        // الـ ULID المفصول للـ URL paths
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "expired" | "refunded";
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  buyerReturnUrl: string;
  providerReference: string | null;
  failureReason: string | null;
  attempts: Array<{ at: Date; kind: string; status: "success"|"failure"; payload?: unknown }>;
  createdAt: Date;
  updatedAt: Date;
}
// Indexes: { coreSessionQid } unique, { stripeCheckoutSessionId } sparse,
//          { store, createdAt:-1 }
```

#### `refunds`
```ts
{
  store: string;
  paymentAppQid: string;
  paymentSessionQid: string;
  stripeRefundId: string | null;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
// Index: { paymentSessionQid }
```

### Prisma SQLite (`prisma/dev.db`) — جلسات Qumra فقط
```prisma
model Session {
  id            String    @id @unique @default(cuid())
  store         String    @unique
  isOnline      Boolean   @default(false)
  accessToken   String
  scope         String?
  expires       DateTime?
  userId        String?
  firstName     String?
  lastName      String?
  email         String?
  emailVerified Boolean?  @default(false)
  refreshToken  String?
  createdAt     DateTime  @default(now())
  lastSeenAt    DateTime  @default(now())
}
```
**مفيش business data في SQLite** — لو غيّرت الـ db.file، الجلسات بتروح بس، بيانات الدفع في Mongo مش بتتأثر.

---

## 11) متغيّرات البيئة (`.env`)

| المتغيّر | الغرض | المصدر |
|---|---|---|
| `QUMRA_API_KEY` | clientId للتطبيق | يحقن بـ `qumra app dev` تلقائيًا |
| `QUMRA_API_SECRET` | السر للـ HMAC | يحقن بـ `qumra app dev` |
| `QUMRA_APP_URL` | URL الـ cloudflared tunnel | يحقن بـ `qumra app dev` (يتغير كل restart) |
| `QUMRA_CORE_URL` | URL الـ core | `http://localhost:4006/v1` (dev) |
| `DATABASE_URL` | Prisma SQLite | `file:./prisma/dev.db` |
| `MONGODB_URL` | Mongo URL (standard non-SRV) | راجع القسم 5 |
| `MONGODB_DB` | اسم الـ DB | `qumra_stripe_app` |
| `STRIPE_SECRET_KEY` | المفتاح السري | `sk_test_…` (test mode) |
| `STRIPE_PUBLISHABLE_KEY` | المفتاح العام | placeholder حاليًا |
| `STRIPE_WEBHOOK_SECRET` | سر الـ webhook | `whsec_…` |
| `DEV_MOCK_BYPASS_TOKEN` | لتجاوز HMAC في dev (curl smoke tests) | random hex |
| `NODE_ENV` | environment | `development` / `production` |

⚠️ الـ `.env` مش في git. لو ضاعت قيمها، الـ Mongo + Stripe احتفاظًا بنسخ في Atlas dashboard / Stripe dashboard.

---

## 12) عقود الـ Routes (مرجع سريع)

### `POST /payment-session` (core inbound)
- **Headers:** HMAC الكاملة (راجع القسم 6).
- **Body in:** `{ sessionId, amount, currency, buyerReturnUrl, order?: {id} }`.
- **Body out (snake_case إجباري):** `{ redirect_url, provider_reference, expires_at? }`.
- **Errors:** 400 `missing_required_fields`, 401 HMAC failures, 503 `stripe_not_configured`.

### `POST /refund-session` (core inbound)
- **Headers:** HMAC.
- **Body in:** `{ sessionId, amount?, currency? }`.
- **Body out (snake_case):** `{ ok: true, refund_id, status }`.

### `POST /capture-session` / `POST /void-session` (core inbound)
- Stripe Checkout بيـ capture/void تلقائيًا → الـ routes دي stubs، بترجّع success.

### `POST /stripe/webhook/:paymentAppQid` (Stripe inbound)
- **Headers:** `stripe-signature`.
- **Body:** Stripe event JSON.
- **Events متعامل معاها:**
  - `checkout.session.completed` → success
  - `checkout.session.async_payment_succeeded` → success
  - `checkout.session.expired` → failure (`reason: checkout_expired`)
  - `checkout.session.async_payment_failed` → failure (`reason: payment_failed`)
  - `charge.refunded` → no-op
- **Response:** `{ received: true }` دائمًا (Stripe بتعيد المحاولة لو 4xx/5xx).

### `GET /return/:sessionQid` (buyer browser)
- **Query:** `status=success|cancelled`.
- **Behavior:** راجع 9.5.

### `POST /webhooks/app-uninstalled` (core inbound)
- مسح credentials للمتجر من Mongo.

---

## 13) Stripe — التفاصيل

### إنشاء Checkout (في `stripe.server.ts:createCheckout`)
```ts
stripe.checkout.sessions.create({
  mode: "payment",
  payment_method_types: ["card"],
  line_items: [{
    price_data: {
      currency: input.currency.toLowerCase(),    // "sar" / "usd"...
      unit_amount: Math.round(input.amount * 100),  // major → minor
      product_data: { name: input.description ?? `Order ${ulid}` }
    },
    quantity: 1
  }],
  customer_email: input.customerEmail,
  success_url: `${appUrl}/return/${ulid}?status=success`,
  cancel_url:  `${appUrl}/return/${ulid}?status=cancelled`,
  metadata: { coreSessionQid, coreSessionUlid, paymentAppQid, store }
});
```
> **مهم:** المبلغ يدخل Stripe بالـ minor units (×100). والـ metadata.coreSessionQid هو اللي بيقفل الـ loop لما الـ webhook يجي.

### الـ Webhook التلقائي (في `stripe.server.ts:ensureWebhookEndpoint`)
- يـ list موجودين، لو فيه واحد بنفس الـ URL يرجّعه (idempotent).
- لو لأ، يـ create webhook على Stripe بـ events:
  ```
  checkout.session.completed
  checkout.session.expired
  checkout.session.async_payment_succeeded
  checkout.session.async_payment_failed
  charge.refunded
  ```

### API Version
- حاليًا `"2025-02-24.acacia"` في `stripe.server.ts:29,44`.
- لما تحدّث Stripe SDK لازم تطابق.

---

## 14) الحالة الحالية (Status)

### ✅ تم
- [x] CLI authentication + app registration (clientId محصل عليه)
- [x] Project scaffold كامل (12 routes + 6 lib + admin UI)
- [x] TypeScript clean (`npx tsc --noEmit` = 0 errors)
- [x] `qumra app dev` بيشتغل، tunnel بيتفتح، الـ dashboard ظاهر فعلاً
- [x] MongoDB connection (standard URL يحل مشكلة الـ SRV)
- [x] vite — `allowedHosts: true` يحل tunnel host blocking
- [x] qumra.app.json — `payment_apps:write` شيلناه، `topics:[]` plural صح
- [x] Navigation — `<Link>` بيـ preserve `?store=...`
- [x] **2026-05-25** — ربط الـ orders في core تم. تطبيق Stripe بيظهر في صفحة الـ checkout كاختيار، الأوردر بيتحوّل لـ Stripe Checkout عند الاختيار، الأوردر بيتعلّم paid عند نجاح الدفع. التفاصيل في `core-service/STRIPE-ORDER-INTEGRATION.md`.

### 🚧 لسه
- [ ] **اختبار E2E** — checkout كامل من المتجر → Stripe → resolve → order paid (لسه ما اتجربش بأوردر حقيقي).
- [ ] **تثبيت التطبيق على المتجر التجريبي `54ygbeof.qumra.store`** + إدخال مفاتيح Stripe (المرة الأولى).
- [ ] **Production deployment** — `productionUrl` فاضي في `qumra.app.json`.
- [ ] **تشفير `stripeSecretKey`** في Mongo (حاليًا plaintext).
- [ ] **معالجة Stripe API version updates** — التحديث الدوري.

---

## 15) Gotchas المهمة (احفظهم)

### 15.1 Node version
- `qumra` CLI بتستخدم `node:sqlite` built-in module → **محتاج Node 22.5+، الأفضل Node 24 LTS**.
- المستخدم بيستخدم nvm-windows. الـ default ممكن يرجع لـ v20.
- **الحل:** `nvm install 24.0.0 && nvm use 24.0.0` (PowerShell admin).

### 15.2 الـ `qumra` CLI commands
- Login: `qumra user login` (مش `qumra login`).
- Help: `qumra --help`.
- App: `qumra app init` / `qumra app dev` / `qumra app deploy`.

### 15.3 OneDrive ❌
- متحطش node projects في OneDrive — npm install بيفشل بـ EPERM/ECONNRESET.
- التطبيق ده في `C:\PC\` متعمّد. ✅

### 15.4 MongoDB SRV records
- شبكة المستخدم بترفض SRV → استخدم standard non-SRV URL.
- لتفكيك SRV manually:
  ```bash
  nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net 8.8.8.8
  nslookup -type=TXT <cluster>.mongodb.net 8.8.8.8
  ```

### 15.5 Atlas IP allowlist
- لو الاتصال refused حتى بـ standard URL → Atlas → Network Access → Add IP → `0.0.0.0/0` (dev only).

### 15.6 Port 3000
- لو `Port 3000 is in use, trying another one...` → Vite ينتقل لـ 3001 لكن الـ tunnel يفضل يوجّه لـ 3000 → التطبيق ما بيلودش.
- **الحل:**
  ```powershell
  netstat -ano | findstr :3000
  taskkill /F /PID <pid>
  ```

### 15.7 `<Link>` بدون search params = كسر
- `authenticate.admin` بتعتمد على `?store=...` — مفيش cookie fallback.
- أي `<Link>`:
  ```tsx
  const search = useLocation().search;
  <Link to={`/path${search}`}>...</Link>
  ```

### 15.8 Vite tunnel host blocking
- الـ cloudflared tunnel URL بيتغير كل restart.
- `vite.config.ts` بـ `allowedHosts: true` بيقبل أي host (dev only).

### 15.9 qumra.app.json schema
- ❌ مفيش `extensions` field — الـ extensions تتعمل بـ `qumra app extension` command.
- ❌ مفيش `topic`/`endpoint` (singular) — لازم `topics: [...]` (plural array) و `uri`.
- ❌ scope `payment_apps:write` مش موجود — الـ scopes المتاحة محدودة.

### 15.10 Stripe API version
- TypeScript حاليًا بياخد `"2025-02-24.acacia"` في `stripe.server.ts:29,44`.

### 15.11 Form POST actions ما تستخدمش `authenticate.admin`
- `authenticate.admin(request)` للـ POST بتعتبر الـ body **JSON + HMAC-signed**.
- `<Form method="post">` بيبعت `application/x-www-form-urlencoded` → `JSON.parse` يكسر بـ:
  ```
  Unexpected token 's', "secretKey="... is not valid JSON
  ```
- **الحل:** `authenticateAction()` في `app/lib/admin-auth.server.ts` يقرأ `?store=...` من URL ويـ load session من Prisma manually.
- في loaders (GET) خلي `authenticate.admin` زي ما هي.

### 15.12 الـ env vars اللي CLI بيحقنها
- `QUMRA_API_KEY` = clientId
- `QUMRA_API_SECRET` = secretKey (HMAC secret)
- `QUMRA_APP_URL` = tunnel URL
- في production لازم export يدوي.

### 15.13 لا تشغّل `qumra app dev` من WSL
- TUI ويندوز فقط — لازم PowerShell على Windows. Claude يقدر يساعد المستخدم ينفّذها.

### 15.14 snake_case vs camelCase
- رد التطبيق على `payment.session.create` → **snake_case**.
- رد التطبيق على resolve/reject للـ core → **camelCase**.
- core تقفل بـ `INVALID_PROVIDER_RESPONSE` لو خانتها.

---

## 16) Commands المفيدة

### Setup (مرة واحدة)
```powershell
nvm install 24.0.0
nvm use 24.0.0
npm install -g @qumra/cli
qumra user login
```

### Dev يومي
```powershell
cd "C:\PC\qumra app\stripe"
node -v   # لازم v24.x.x

# لو في port 3000 محجوز:
netstat -ano | findstr :3000
taskkill /F /PID <pid>

qumra app dev
# p = افتح المتصفح · q = اخرج
```

### Typecheck (من WSL برضو ينفع)
```bash
# من WSL — node.exe الويندوز مع Windows-path args
cd "/mnt/c/PC/qumra app/stripe"
"/mnt/c/Program Files/nodejs/node.exe" 'node_modules\typescript\bin\tsc' --noEmit
```
أو من PowerShell:
```powershell
cd "C:\PC\qumra app\stripe"
npx tsc --noEmit
```

### Smoke test (HMAC bypass — بدون core)
```powershell
curl -X POST "https://<tunnel>/payment-session" `
  -H "Content-Type: application/json" `
  -H "X-Qumra-Payment-App-Qid: qid://qumra/PaymentApp/test" `
  -H "X-Dev-Mock-Bypass: <DEV_MOCK_BYPASS_TOKEN من .env>" `
  -d '{\"sessionId\":\"qid://qumra/PaymentSession/TEST123\",\"amount\":50,\"currency\":\"USD\",\"buyerReturnUrl\":\"https://example.com/done\"}'
```
المفروض يرجّع `{ "redirect_url": "https://checkout.stripe.com/...", "provider_reference": "cs_test_...", "expires_at": "..." }`.

### Mongo (من Atlas web UI أو mongosh)
```js
use qumra_stripe_app
db.store_settings.find()
db.payment_sessions.find().sort({createdAt:-1}).limit(5)
db.refunds.find().sort({createdAt:-1}).limit(5)
```

### Stripe test cards
- `4242 4242 4242 4242` — success
- `4000 0000 0000 0002` — declined
- `4000 0000 0000 9995` — insufficient funds
- أي تاريخ مستقبلي (مثلاً 12/30) · أي CVC (123)

---

## 17) ملفات مرجعية مرتبطة (في مشروع تاني)

### في `C:\Users\amoha\OneDrive\Desktop\new qumra\core-service\`
- `STRIPE-ORDER-INTEGRATION.md` — توثيق ربط الـ orders بالتطبيق ده (2026-05-25).
- `stripe-order-integration.html` — نسخة HTML.
- `src/cores/payment-app-service/` — الـ module اللي بيتكلم مع التطبيق ده:
  - `services/call-payment-app.service.ts` — كيف core يبعت لنا
  - `services/create-payment-session.service.ts` — body shape
  - `services/resolve-payment-session.service.ts` — استقبال resolve
  - `services/settle-order-payment.service.ts` — تسوية الأوردر (2026-05-25)
  - `lib/hmac.util.ts` — توقيع
  - `guards/verify-payment-app-hmac.guard.ts` — استقبال HMAC
  - `services/register-from-installation.service.ts` — التسجيل
  - `IMPLEMENTATION.md` — توثيق الـ module

### Reference قديم (Shopify version)
- `C:\PC\shopify-app\payment\` — الـ Shopify version. الـ patterns مش 1:1 transferable لكن مفيدة كمرجع.

### الـ Apps الموازية المخطّطة (في `C:\PC\qumra app\`)
- `paypal/` — مخطّط
- `moyasser/` — مخطّط (Saudi Moyasar)
- `kashier/` — مخطّط (Egyptian, HPP-based)
- `paymob/` — تم البناء 2026-05-24 (HMAC-SHA512 + iframe 3-step)

---

## 18) Session-Start Checklist (لو دخلت session جديدة)

1. **اقرأ القسمين 1 + 2 + 14** — اعرف الهدف، المستخدم، والحالة.
2. **اسأل المستخدم:** "إيه اللي عايز نعمله دلوقتي؟" قبل ما تبدأ كود.
3. **شيك على `git status`** في `C:\PC\qumra app\stripe`.
4. لو هتشغّل dev:
   - تأكد Node 24: `node -v`
   - تأكد port 3000 فاضي: `netstat -ano | findstr :3000`
   - من PowerShell على Windows: `qumra app dev`
5. لو الموضوع متعلّق بربط الـ orders → اقرأ `core-service/STRIPE-ORDER-INTEGRATION.md` كمان.
6. لو محتاج تعمل typecheck من WSL → استخدم node.exe الويندوز (راجع القسم 16).

---

## 19) قواعد للـ Claude في أي سيشن

- ❌ متحاولش تشغّل `qumra app dev` من WSL — TUI ويندوز فقط.
- ✅ ساعد المستخدم يشغّله من PowerShell.
- ❌ متخمّنش الـ HMAC headers/topics/payloads — التفاصيل هنا والـ core موثّق.
- ✅ لو `Missing 'store' parameter` error → 99% navigation بدون preserve search.
- ❌ متكتبش `<Form>` تتفاعل مع core بدون HMAC — `<Form>` للـ admin user فقط.
- ✅ كل response لـ core على `payment-session` لازم snake_case.
- ✅ كل callback لـ core (resolve/reject/pending) لازم camelCase في الـ body.
- ❌ متحطّش node projects في OneDrive.
- ✅ التطبيق ده side-by-side مع `C:\PC\shopify-app\payment\` — لو المستخدم قال "زي اللي في Shopify"، شوف هناك أول.
- ✅ المستخدم بيفضّل التنفيذ التلقائي — متسألش أسئلة تأكيدية لكل خطوة، نفّذ ولخّص.

---

## 20) خاتمة

الملف ده مرجع كامل. لو فيه حاجة مش واضحة في الكود، الأرجح إنها هنا. لو في حاجة هنا مش في الكود، اعتبرها planned/legacy/wrong-and-needs-update.

**صاحب المشروع:** qumracloud@gmail.com · **آخر تحديث:** 2026-05-25
