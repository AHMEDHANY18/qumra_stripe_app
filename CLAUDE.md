# Qumra Stripe Payment App — Session Handoff

> **اقرأ ده الأول لو دخلت session جديد.** الملف ده فيه كل اللي اتعمل، كل اللي مظبوط، كل اللي لسه مفتوح، و كل الـ gotchas اللي وقعنا فيها.
>
> **آخر تحديث:** 2026-05-19
> **مكتوب لـ:** Claude (في session جديد) عشان يفهم السياق فوراً
> **المسار:** `C:\PC\qumra app\stripe\` (Windows) / `/mnt/c/PC/qumra app/stripe/` (WSL)

---

## 0. اللي محتاج تعرفه عن المستخدم

- عربي مصري، beginner-to-intermediate في Qumra apps
- بيفضّل التواصل بالعربية بلهجة مصرية + step-by-step
- بيشتغل من Windows؛ Claude يشتغل من WSL ويصل عبر `/mnt/c/...`
- بيفضّل إن Claude يعمل كل حاجة autonomously (مش Q&A wizard)
- ❌ متحطش node projects في OneDrive — npm install بيفشل بـ EPERM
- استخدم: `C:\PC\` (مش `C:\Users\amoha\OneDrive\...`)

---

## 1. السياق الكبير — إيه هو التطبيق ده؟

تطبيق Qumra Cloud بـ React Router 7 يبقى **bridge بين Qumra core و Stripe**:

```
  ┌──────────────────┐       ┌────────────────────┐       ┌──────────────┐
  │   Qumra core     │──HMAC─▶│  هذا التطبيق        │──API──▶│   Stripe     │
  │  (localhost:4006)│◀─HMAC─│  (cloudflared       │◀webhook│              │
  └──────────────────┘       │   tunnel)          │       └──────────────┘
                              └────────────────────┘
                                       │
                                       ▼
                                  ┌─────────────┐
                                  │  Atlas Mongo│  + Prisma/SQLite (Qumra sessions)
                                  └─────────────┘
```

- **core لا يعرف Stripe.** Stripe لا يعرف core. التطبيق هو المترجم.
- التطبيق بيسجّل نفسه عند core كـ payment provider بعد install.
- core بيكلّمنا بـ HMAC-signed POSTs على 4 endpoints (`payment-session`, `refund`, `capture`, `void`).
- Stripe بيكلّمنا بـ webhook لما الدفعة تنجح/تفشل، وإحنا نبلّغ core.

تفاصيل الـ design الأصلي في `core-service/docs/payment-apps-design.html` و الـ implementation في `core-service/src/cores/payment-app-service/`.

---

## 2. الـ Tech Stack

| الطبقة | الاختيار |
|--------|----------|
| Framework | React Router 7 (SSR mode) |
| TypeScript | `strict: true`, `target: ES2022` |
| UI | Tailwind v4 + RTL (Cairo font العربية) |
| Embed bridge | `@qumra/jisr` — `QumraAppBridgeProvider`, `useNavigationMenu`, `useToast`, etc. |
| Qumra auth | `@qumra/app-react-router` — `qumraApp()` factory |
| Qumra session storage | **Prisma + SQLite** (`@qumra/app-session-storage-prisma`) — local file `prisma/dev.db` |
| Payment business data | **MongoDB** (separate from Qumra sessions) — Atlas cluster |
| Payment provider | `stripe` v17 (server SDK, Stripe Checkout mode) |
| Dev tunnel | cloudflared (managed by `qumra app dev`) |
| Bundler | Vite 7 + `@react-router/dev` |

---

## 3. Project IDs و الـ credentials

```
clientId:   bee542d6-8338-42c8-bf3d-c50b3366a15a    (in .qumra/qumra.config.json)
devStore:   54ygbeof.qumra.store                     (in .qumra/qumra.config.json)
Org:        stripe
App:        stripe
Install URL: https://app.qumra.cloud/store/54ygbeof/apps/stripe
```

**Atlas MongoDB:**
- Cluster: `cluster0.1gdx53y.mongodb.net`
- User: `qumra` / pass: `qumra-pass`
- DB: `qumra_stripe_app` (separate from core's `core-service` DB)
- Replica set: `atlas-j0xh3g-shard-0`
- Hosts (standard non-SRV URL):
  ```
  ac-vgmahyf-shard-00-00.1gdx53y.mongodb.net:27017
  ac-vgmahyf-shard-00-01.1gdx53y.mongodb.net:27017
  ac-vgmahyf-shard-00-02.1gdx53y.mongodb.net:27017
  ```

**Stripe (TEST mode):**
- في `.env` (مش committed). `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` معروفين.
- `STRIPE_PUBLISHABLE_KEY` لسه placeholder — لما يحتاجها المستخدم يضيفها من dashboard.stripe.com/test/apikeys

---

## 4. الـ HMAC Contract (مهم جداً، لا تخمّن)

### Headers اللي core بيبعتها لنا (أو إحنا نبعتها لـ core)

| Header | محتوى |
|--------|-------|
| `X-Qumra-Topic` | اسم العملية (e.g. `payment.session.create`, `payment.session.resolve`) — **dots مش underscores** |
| `X-Qumra-Hmac-Sha256` | `base64(HMAC-SHA256(rawBody, App.secretKey))` |
| `X-Qumra-App-Client-Id` | الـ clientId بتاع التطبيق |
| `X-Qumra-Payment-App-Qid` | الـ qid للـ PaymentApp في core |
| `X-Qumra-Timestamp` | ISO-8601، tolerance **±5 دقائق** |

### Topics

| Direction | Topic | الـ endpoint |
|-----------|-------|-------------|
| core → us | `payment.session.create` | POST `/payment-session` |
| core → us | `payment.refund.create` (مستقبل) | POST `/refund-session` |
| core → us | `payment.capture.create` (مستقبل) | POST `/capture-session` |
| core → us | `payment.void.create` (مستقبل) | POST `/void-session` |
| us → core | `payment.session.resolve` | POST `/v1/payment-sessions/:ulid/resolve` |
| us → core | `payment.session.reject` | POST `/v1/payment-sessions/:ulid/reject` |
| us → core | `payment.session.pending` | POST `/v1/payment-sessions/:ulid/pending` |

### قواعد ذهبية

1. **الـ HMAC على raw body** — قبل أي `JSON.parse`. لو parse الأول، التوقيع يفسد.
2. **الـ response من `/payment-session` لازم snake_case**: `{ redirect_url, provider_reference, expires_at? }`. camelCase → core ترفضها بـ `INVALID_PROVIDER_RESPONSE`.
3. **الـ sessionId** اللي core بيبعته شكله `qid://qumra/PaymentSession/01HX...`. لما نـ POST لـ core نـ resolve، الـ URL path يستخدم الـ **ULID فقط** (مش الـ qid كامل) — في `core-callback.ts` فيه `ulidOf()` helper.
4. **الـ provider هو اللي يقول لـ core "نجح/فشل" server-to-server.** المتصفح مش مصدر الحقيقة. بعد Stripe webhook → نـ POST لـ core → core يرد بـ `nextAction.redirectUrl` → الـ buyer لما يرجع نوجهه عليه.
5. **`App.secretKey`** هو نفسه `QUMRA_API_SECRET` (الـ env var اللي `qumra app dev` بيحقنها). ده الـ HMAC secret.

تفاصيل الـ schema و الـ verification في `core-service/src/cores/payment-app-service/`:
- `lib/hmac.util.ts` — sign/verify
- `guards/verify-payment-app-hmac.guard.ts` — inbound verifier
- `services/call-payment-app.service.ts` — outbound caller
- `services/create-payment-session.service.ts` — body shape (سطر 86-93)

---

## 5. الـ Auth Flow (Qumra side)

`authenticate.admin(request)` من `@qumra/app-react-router`:

- **GET** requests: بتقرأ `?store=<sub>.qumra.store` من URL query. لو missing → بترمي `QumraAuthError('Missing store parameter')`.
- **POST** requests: بتعتمد على HMAC headers (webhook/action verification).
- مفيش cookie fallback ⚠️ — كل request محتاج `store` في الـ URL.

**نتيجة:** لما المستخدم يعمل client-side navigation بـ `<Link to="/settings">`، لازم نـ preserve الـ search params:

```tsx
import { Link, useLocation } from "react-router";
const search = useLocation().search;
<Link to={`/settings${search}`}>...</Link>
```

تم تطبيق ده في `_app._index.tsx`. أي صفحة جديدة تضيفها لازم تتبع نفس الـ pattern.

---

## 6. ملفات حرجة و وظيفتها

### Config
| الملف | المحتوى | تحرير؟ |
|------|---------|--------|
| `.qumra/qumra.config.json` | clientId + devStore — CLI-managed | ❌ ما تحررش يدوياً |
| `qumra.app.json` | scopes + webhooks + productionUrl — synced live during dev | ✅ user-editable |
| `.env` | secrets (Stripe + Mongo + DEV_MOCK_BYPASS_TOKEN) | ✅ مش في git |
| `package.json` | deps (`stripe`, `mongodb`, `@qumra/*`, Prisma, React Router 7) | ✅ |
| `vite.config.ts` | `allowedHosts: true` (cloudflared tunnels تتغير كل restart) | ✅ |

### App code (`app/`)
| الملف | الوظيفة |
|------|---------|
| `qumra.server.ts` | `qumraApp({ apiKey, secretKey, sessionStorage: PrismaSessionStorage, ... })` |
| `db.server.ts` | MongoDB lazy client + collections: `store_settings`, `payment_sessions`, `refunds` |
| `lib/hmac.ts` | `signRawBody`, `verifyRawBody` (base64 HMAC-SHA256 + timingSafeEqual) |
| `lib/verify-hmac-request.ts` | يتحقق من inbound من core + dev bypass token |
| `lib/core-callback.ts` | `resolveSession`, `rejectSession`, `pendingSession`, `getSession` |
| `lib/stripe.server.ts` | `getStripeConfigForStore`, `getStripeConfigByPaymentAppQid`, `createCheckout`, `ensureWebhookEndpoint` |
| `lib/payment-app-registration.server.ts` | `ensurePaymentProviderRegistered` (idempotent) |

### Routes (`app/routes/`)
| الـ Route | الـ Method | الوظيفة |
|----------|----------|---------|
| `_app.tsx` | GET | parent: auth + auto-register + nav menu |
| `_app._index.tsx` | GET | Dashboard (stats + status banners) |
| `_app.settings.tsx` | GET/POST | Stripe keys form + auto-create webhook |
| `_app.transactions.tsx` | GET | Last 50 payment sessions |
| `auth.$.tsx` | GET | OAuth callback (`authenticate.admin`) |
| `payment-session.tsx` | POST | core inbound — create Stripe Checkout |
| `refund-session.tsx` | POST | core inbound — refund via Stripe |
| `capture-session.tsx` | POST | stub (auto-captured by Checkout) |
| `void-session.tsx` | POST | stub (auto-captured) |
| `stripe.webhook.$paymentAppQid.tsx` | POST | Stripe → us → notify core (resolve/reject) |
| `return.$sessionQid.tsx` | GET | Buyer return — polls if webhook hasn't arrived |
| `webhooks.app-uninstalled.tsx` | POST | Clear credentials on uninstall |

### Prisma (Qumra sessions only — مش business data)
- `prisma/schema.prisma` — `Session` model
- `prisma/dev.db` — SQLite file (git-ignored)
- `prisma/lib/prisma.ts` — singleton client

---

## 7. الـ Flow الكامل (مع الـ source-of-truth)

### 7.1 Install
1. التاجر يفتح Qumra App Store على `54ygbeof.qumra.store` → يضغط Install على stripe
2. OAuth flow بيخلص → التطبيق يلود في iframe بـ `?store=<sub>.qumra.store&id_token=<jwt>&...`
3. `_app.tsx` loader بيـ run:
   - `authenticate.admin(request)` → بيخزن session في Prisma SQLite
   - `ensurePaymentProviderRegistered(store, QUMRA_APP_URL)` → بيـ POST لـ `core/v1/payment-apps/from-installation`
   - بيخزن `paymentAppQid` في Mongo `store_settings`

### 7.2 Configure (في الـ admin UI)
4. التاجر يفتح `/settings` (preserve search params)
5. يدخل Stripe `sk_test_...` + `pk_test_...`
6. `_app.settings.tsx` action:
   - يـ validate الـ secret بـ `stripe.accounts.retrieve()`
   - يـ create Stripe webhook endpoint بـ URL `<tunnel>/stripe/webhook/<paymentAppQid>` تلقائياً
   - يحفظ في Mongo `store_settings`

### 7.3 Checkout
7. Buyer يبدأ checkout على المتجر
8. core بيـ POST `/v1/payment-apps/sessions` (الـ entry point في core)
9. core ينشئ `PaymentSession` (status=pending) و يـ POST `/payment-session` لتطبيقنا (HMAC-signed)
10. تطبيقنا:
    - يـ verify HMAC على raw body
    - يقرأ `{ sessionId, amount, currency, buyerReturnUrl }`
    - ينشئ Stripe Checkout مع `success_url=<tunnel>/return/<ULID>`
    - يحفظ `payment_sessions` في Mongo بـ status=pending
    - يرجّع `{ redirect_url, provider_reference, expires_at }` (snake_case!)
11. core يحفظ الـ URL و يبعته للـ buyer

### 7.4 Payment
12. Buyer يدفع على Stripe (test card: `4242 4242 4242 4242`)
13. **Stripe → us:** `checkout.session.completed` webhook → `/stripe/webhook/<qid>`
    - تطبيقنا يـ verify Stripe signature
    - يحدّث `payment_sessions` بـ status=succeeded
    - يـ POST لـ `core/v1/payment-sessions/<ULID>/resolve` (HMAC-signed)
    - core يرد بـ `{ nextAction: { redirectUrl } }`
14. **Buyer → us:** Stripe success_url يـ redirect على `/return/<ULID>`
    - لو الـ webhook وصل قبل: نـ 302 على `nextAction.redirectUrl` فوراً
    - لو الـ webhook لسه ما وصلش: نـ show polling page + auto-refresh كل 2 ثانية

### 7.5 Refund
15. التاجر يضغط Refund في core admin
16. core يـ POST `/refund-session` لتطبيقنا (HMAC)
17. تطبيقنا يـ `stripe.refunds.create(...)` و يحفظ refund record

---

## 8. الحالة الحالية (آخر مرة اتحدّث الملف)

### ✅ ما تم

- [x] CLI authentication + app registration (clientId محصل عليه)
- [x] Project scaffold كامل في `C:\PC\qumra app\stripe\`
- [x] كل الـ Stripe routes (12 ملف) + lib (5 ملف) + admin UI
- [x] TypeScript clean (`npx tsc --noEmit` بدون errors)
- [x] `qumra app dev` بيشتغل، tunnel بيتفتح، **الـ dashboard ظهر فعلاً في الـ admin** (شوف screenshot الـ user اللي بعت)
- [x] MongoDB SRV → standard URL conversion (DNS issue حل)
- [x] vite.config — `allowedHosts: true` (tunnel host blocking حل)
- [x] qumra.app.json — صح scope names (`payment_apps:write` غير موجود، شيلناه)
- [x] qumra.app.json — صح webhook schema (`topics: [...]` array مش `topic: "..."` string)
- [x] Navigation — `<Link>` بيـ preserve `?store=...` search params

### 🚧 ما لم يُنفّذ بعد

- [ ] **Port 3000 conflict** — في process قديم محتجز الـ port (Vite انتقل لـ 3001 → tunnel ميوصلش)
- [ ] **MongoDB connection اختبار E2E** — لسه ما اتأكدش إن الاتصال شغّال (لما الـ port issue يتحل)
- [ ] **Payment extension declaration** — `qumra app extension` ممكن مفيهاش `payment` type لسه. لو غير متاح، الـ from-installation registration هيرجع `APP_NOT_PAYMENT_PROVIDER` من core
- [ ] **Stripe webhook URL auto-creation** — لسه ما اتجربش (محتاج user يحفظ Stripe keys في الـ admin)
- [ ] **E2E test** — payment flow كامل من core checkout لـ Stripe → resolve
- [ ] **production deployment** — `productionUrl` فاضي في qumra.app.json
- [ ] **Encryption للـ `stripeSecretKey`** — حالياً plaintext في Mongo

---

## 9. Gotchas المهمة (احفظهم)

### 9.1 Node version
- الـ qumra CLI بتستخدم `node:sqlite` built-in module → **محتاج Node 22.5+ على الأقل، الأفضل Node 24 LTS**
- المستخدم عنده nvm-windows. الـ default ممكن يرجع لـ v20 بعد reboot/new shell.
- **الحل:** PowerShell as Administrator → `nvm use 24.0.0`. لو مش متثبت: `nvm install 24.0.0`.

### 9.2 الـ `qumra` CLI command structure
- التسجيل: `qumra user login` (مش `qumra login`)
- الـ help: `qumra --help` (مش `qumra --version`)
- التطبيق: `qumra app init` / `qumra app dev` / `qumra app deploy`

### 9.3 OneDrive
- ❌ متحطش node projects في OneDrive (npm install بيفشل)
- ✅ استخدم `C:\PC\` (الحالي)

### 9.4 MongoDB SRV
- شبكة المستخدم بترفض SRV records → استخدم standard non-SRV URL
- لو غيّر cluster، فك الـ SRV manually:
  ```bash
  nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net 8.8.8.8
  nslookup -type=TXT <cluster>.mongodb.net 8.8.8.8
  ```

### 9.5 Atlas IP allowlist
- لو الاتصال refused حتى بـ standard URL، Atlas → Network Access → Add IP → `0.0.0.0/0` (dev only)

### 9.6 Port 3000
- لو `Port 3000 is in use, trying another one...` ظهر في الـ logs، Vite ينتقل لـ 3001 لكن الـ tunnel يفضل يوجه لـ 3000 → التطبيق ما بيلودش
- **الحل:**
  ```powershell
  netstat -ano | findstr :3000
  taskkill /F /PID <pid>
  ```
- زومبي processes من `qumra app dev` سابق هي السبب الأشيع.

### 9.7 `<Link>` بيكسر بدون search params
- `authenticate.admin` بتعتمد على `?store=...` في الـ URL — مفيش cookie fallback
- أي `<Link>` لـ admin route لازم: `to={`/path${useLocation().search}`}`

### 9.8 vite tunnel host blocking
- الـ cloudflared tunnel URL بيتغيّر كل restart → Vite بـ `allowedHosts: [specific-host]` بيرفض
- **الحل المعمول حالياً:** `allowedHosts: true` في vite.config.ts

### 9.9 qumra.app.json schema
- ❌ مفيش `extensions` field في الـ JSON (الـ extensions تتعمل بـ `qumra app extension` command)
- ❌ مفيش `topic`/`endpoint` (singular) في الـ webhooks subscriptions — لازم `topics: [...]` (plural array) و `uri`
- ❌ scope `payment_apps:write` مش موجود — الـ scopes المتاحة محدودة (شوف الـ error من manifest sync لما حصل)

### 9.10 Stripe API version
- TypeScript حالياً بياخد `apiVersion: "2025-02-24.acacia"` — لما تتحدث Stripe SDK لازم تطابق

### 9.12 الـ Form POST actions ما تستخدمش `authenticate.admin`
- `authenticate.admin(request)` للـ POST بتعتبر الـ body **JSON + HMAC-signed** (webhook/action pattern)
- `<Form method="post">` بيبعت `application/x-www-form-urlencoded` → الـ JSON.parse بيكسر بـ:
  ```
  Unexpected token 's', "secretKey="... is not valid JSON
  ```
- **الحل المعمول حالياً:** helper `authenticateAction()` في `app/lib/admin-auth.server.ts` يقرأ `?store=...` من URL و يـ load الـ session من Prisma manually
- في action handlers، استخدم `authenticateAction(request)` بدل `authenticate.admin(request)`
- في loaders (GET) خلي `authenticate.admin` زي ما هي

### 9.11 الـ env vars اللي CLI بيحقنها
- `QUMRA_API_KEY` = clientId
- `QUMRA_API_SECRET` = secretKey (HMAC secret)
- `QUMRA_APP_URL` = tunnel URL
- بنحقنهم في `qumra.server.ts` و `core-callback.ts` و في كل مكان محتاجهم
- في production لازم تعمل export يدوياً (مش CLI-managed)

---

## 10. Commands المفيدة

### Setup (مرة واحدة فقط)
```powershell
# Node version (admin)
nvm install 24.0.0
nvm use 24.0.0

# CLI (admin)
npm install -g @qumra/cli

# Login
qumra user login
```

### Daily dev workflow
```powershell
cd "C:\PC\qumra app\stripe"

# تأكد من Node 24
node -v   # لازم v24.x.x

# لو في port 3000 محجوز:
netstat -ano | findstr :3000
taskkill /F /PID <pid>

# شغّل
qumra app dev

# اضغط p لفتح المتصفح، q للخروج
```

### Type-check
```powershell
cd "C:\PC\qumra app\stripe"
npx tsc --noEmit
```

### Smoke test (بدون core)
```powershell
# استبدل tunnel URL بالـ URL الحالي
curl -X POST "https://<tunnel>/payment-session" `
  -H "Content-Type: application/json" `
  -H "X-Qumra-Payment-App-Qid: qid://qumra/PaymentApp/test" `
  -H "X-Dev-Mock-Bypass: 9b0ee973c9f014cbb372c28b233ecfba30774c5479f20d021467479e6711f27a" `
  -d '{\"sessionId\":\"qid://qumra/PaymentSession/TEST123\",\"amount\":50,\"currency\":\"USD\",\"buyerReturnUrl\":\"https://example.com/done\"}'
```

### Mongo check (من Atlas web UI أو mongosh)
```js
use qumra_stripe_app
db.store_settings.find()
db.payment_sessions.find().sort({createdAt:-1}).limit(5)
```

### Stripe test cards
```
رقم البطاقة: 4242 4242 4242 4242
تاريخ:        أي تاريخ مستقبلي (12/30)
CVC:          أي 3 أرقام (123)
```

---

## 11. ملفات مرجعية في الـ core-service

(لو محتاج تفهم core side من غير قراءة الكود كله)

- `core-service/src/cores/payment-app-service/IMPLEMENTATION.md` — توثيق الـ module
- `core-service/src/cores/payment-app-service/services/call-payment-app.service.ts` — كيف core يبعت لينا
- `core-service/src/cores/payment-app-service/lib/hmac.util.ts` — توقيع
- `core-service/src/cores/payment-app-service/services/create-payment-session.service.ts` — body shape
- `core-service/src/cores/payment-app-service/services/register-from-installation.service.ts` — شرط `payment` extension
- `core-service/docs/payment-apps-design.html` — التصميم الأصلي
- `core-service/mock-payment-provider/src/lib/core-client.ts` — mock بـ Express (reference)

و في الـ Shopify reference prototype (الـ patterns بس):
- `C:\PC\shopify-app\payment\` — الـ Shopify version (تعليمي، الـ patterns مش 1:1 transferable)

---

## 12. لما تبدأ session جديد، اعمل دول بالترتيب

1. **اقرأ القسم 0 و 1** — اعرف المستخدم والهدف.
2. **اقرأ القسم 8** — اعرف فين وقفنا (Status section).
3. **اسأل المستخدم: "هو في أي خطوة دلوقتي؟"** قبل ما تبدأ كود.
4. **شيك على `git status`** لو في local changes غير محفوظة.
5. لو هتشغل dev:
   - تأكد Node 24: `node -v`
   - تأكد port 3000 فاضي: `netstat -ano | findstr :3000`
   - شغّل: `qumra app dev`

---

## ملحوظة للـ Claude الجديد

- ❌ ما تحاولش تشغّل `qumra app dev` من WSL (مش هيشتغل — TUI Windows tool)
- ✅ ساعد المستخدم يشغّله من PowerShell على Windows
- ❌ ما تخمّنش الـ HMAC headers/topics — الـ schema موثّق في core-service
- ✅ لو في `Missing 'store' parameter` error → السبب 99% navigation بدون preserve search
- ❌ ما تكتبش `<Form>` تتفاعل مع core بدون HMAC sign — هي للـ admin user only
- ✅ كل response لـ core لازم snake_case keys
- ❌ ما تحطش الـ project في OneDrive — كلام واضح في feedback memory

نقطة أخيرة: الـ تطبيق ده بيشتغل **side-by-side** مع `C:\PC\shopify-app\payment\` (الـ Shopify version) كـ reference. لو الـ user قال "زي اللي في Shopify"، شوف هناك أول.
