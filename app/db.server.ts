import { MongoClient, type Collection, type Db } from "mongodb";

/**
 * MongoDB for payment-business data (settings, payment sessions, refunds).
 * Qumra session storage is handled separately by Prisma — see
 * `app/qumra.server.ts`. This DB is independent.
 *
 * Connection is lazy + fault-tolerant: a Mongo outage shouldn't crash the
 * app startup. Operations that need Mongo will fail individually.
 */

// Accept either MONGODB_URL or MONGODB_URI (core-service uses the latter)
const url =
  process.env.MONGODB_URL ??
  process.env.MONGODB_URI ??
  "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB ?? "qumra_stripe_app";

declare global {
  // eslint-disable-next-line no-var
  var __paymentMongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var __paymentMongoConnecting: Promise<MongoClient> | undefined;
}

function getClient(): MongoClient {
  if (global.__paymentMongoClient) return global.__paymentMongoClient;
  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });
  global.__paymentMongoClient = client;
  // Connect in background; don't block module init.
  global.__paymentMongoConnecting = client
    .connect()
    .then(() => {
      console.log(`[mongo] connected to ${dbName}`);
      return client;
    })
    .catch((err) => {
      console.error(`[mongo] connect failed (will retry on demand):`, err.message);
      return client;
    });
  return client;
}

export const db: Db = getClient().db(dbName);

// ─────────────────────────────────────────────────────────────
// Collections
// ─────────────────────────────────────────────────────────────

export interface StoreSettings {
  store: string;                  // "<sub>.qumra.store" — scoping key
  paymentAppQid: string | null;
  stripeSecretKey: string | null; // ⚠️ TODO encrypt at rest
  stripePublishableKey: string | null;
  stripeWebhookSecret: string | null;
  stripeWebhookId: string | null;
  stripeAccountId: string | null;
  configured: boolean;
  testMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentSessionDoc {
  store: string;
  paymentAppQid: string;
  coreSessionQid: string;
  coreSessionUlid: string;
  amount: number;
  currency: string;
  status:
    | "pending"
    | "succeeded"
    | "failed"
    | "expired"
    | "refunded";
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  buyerReturnUrl: string;
  providerReference: string | null;
  failureReason: string | null;
  attempts: Array<{
    at: Date;
    kind: string;
    status: "success" | "failure";
    payload?: unknown;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundDoc {
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

export function getStoreSettings(): Collection<StoreSettings> {
  return db.collection<StoreSettings>("store_settings");
}

export function getPaymentSessions(): Collection<PaymentSessionDoc> {
  return db.collection<PaymentSessionDoc>("payment_sessions");
}

export function getRefunds(): Collection<RefundDoc> {
  return db.collection<RefundDoc>("refunds");
}

let indexesEnsured = false;
export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    await Promise.all([
      getStoreSettings().createIndex({ store: 1 }, { unique: true }),
      getStoreSettings().createIndex({ paymentAppQid: 1 }, { sparse: true }),
      getPaymentSessions().createIndex({ coreSessionQid: 1 }, { unique: true }),
      getPaymentSessions().createIndex({ stripeCheckoutSessionId: 1 }, { sparse: true }),
      getPaymentSessions().createIndex({ store: 1, createdAt: -1 }),
      getRefunds().createIndex({ paymentSessionQid: 1 }),
    ]);
  } catch (err) {
    console.error("[mongo] ensureIndexes failed:", err);
    indexesEnsured = false; // allow retry next time
  }
}
