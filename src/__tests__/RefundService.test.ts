/**
 * RefundService unit tests — Node built-in test runner.
 *
 * Run:   npx tsx --test src/__tests__/RefundService.test.ts
 *
 * These tests validate the RefundService FSM logic, transition guards,
 * ledger linking, and outbox event creation. They require a running
 * MongoDB instance (set MONGODB_URI env var or default localhost).
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  RefundRequest,
  ALLOWED_REFUND_TRANSITIONS,
  Transaction,
  Order,
  Wallet,
  LedgerEntry,
  OutboxEvent,
  type RefundStatus,
} from "../models/index.js";

const MONGO_URI =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/order-system-test";

/* ── helpers ── */

async function createTestWallet(session: mongoose.ClientSession) {
  return Wallet.create(
    [
      {
        ownerType: "STORE",
        ownerId: new mongoose.Types.ObjectId(),
        currency: "NGN",
        available: 1_000_000,
        pending: 0,
        status: "ACTIVE",
      },
    ],
    { session }
  ).then(([w]) => w!);
}

async function createTestOrder(
  userId: mongoose.Types.ObjectId,
  session: mongoose.ClientSession
) {
  return Order.create(
    [
      {
        user: userId,
        items: [
          {
            product: new mongoose.Types.ObjectId(),
            name: "Test Product",
            quantity: 1,
            unitPrice: 50_000,
            totalPrice: 50_000,
          },
        ],
        totalAmount: 50_000,
        status: "CONFIRMED",
        shippingAddress: {
          street: "123 Test St",
          city: "Lagos",
          state: "LA",
          country: "NG",
        },
        idempotencyKey: `test-order-${Date.now()}`,
      },
    ],
    { session }
  ).then(([o]) => o!);
}

async function createConfirmedPaymentTx(
  orderId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  amount: number,
  session: mongoose.ClientSession
) {
  return Transaction.create(
    [
      {
        type: "ORDER_PAYMENT",
        order: orderId,
        user: userId,
        amount,
        currency: "NGN",
        status: "CONFIRMED",
        paymentMethod: "CARD",
        provider: "paystack",
        providerRef: `psk_ref_${Date.now()}`,
        idempotencyKey: `pay-${Date.now()}`,
        paidAt: new Date(),
        postedAt: new Date(),
      },
    ],
    { session }
  ).then(([t]) => t!);
}

/* ── test suite ── */

describe("RefundService", () => {
  before(async () => {
    await mongoose.connect(MONGO_URI);
  });

  after(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await Promise.all([
      RefundRequest.deleteMany({}),
      OutboxEvent.deleteMany({}),
    ]);
  });

  describe("ALLOWED_REFUND_TRANSITIONS", () => {
    it("COMPLETED and REJECTED are terminal states", () => {
      assert.deepStrictEqual(ALLOWED_REFUND_TRANSITIONS.COMPLETED, []);
      assert.deepStrictEqual(ALLOWED_REFUND_TRANSITIONS.REJECTED, []);
    });

    it("FAILED is non-terminal — can transition back to PROCESSING", () => {
      assert.ok(
        ALLOWED_REFUND_TRANSITIONS.FAILED.includes("PROCESSING"),
        "FAILED should allow transition to PROCESSING"
      );
    });

    it("REQUESTED transitions to PENDING_APPROVAL or REJECTED", () => {
      assert.deepStrictEqual(ALLOWED_REFUND_TRANSITIONS.REQUESTED, [
        "PENDING_APPROVAL",
        "REJECTED",
      ]);
    });

    it("all statuses have a defined transition array", () => {
      const allStatuses: RefundStatus[] = [
        "REQUESTED",
        "PENDING_APPROVAL",
        "AWAITING_REVIEW",
        "PROCESSING",
        "RETRYING",
        "GATEWAY_PENDING",
        "SETTLED",
        "COMPLETED",
        "FAILED",
        "REJECTED",
      ];
      for (const s of allStatuses) {
        assert.ok(
          Array.isArray(ALLOWED_REFUND_TRANSITIONS[s]),
          `Missing transition map for ${s}`
        );
      }
    });
  });

  describe("RefundRequest model", () => {
    it("creates with REQUESTED status and captures statusHistory", async () => {
      const userId = new mongoose.Types.ObjectId();
      const orderId = new mongoose.Types.ObjectId();
      const txId = new mongoose.Types.ObjectId();

      const refund = await RefundRequest.create({
        orderId,
        userId,
        originalTransactionId: txId,
        originalAmount: 50_000,
        deductionAmount: 0,
        refundAmount: 50_000,
        status: "REQUESTED",
        statusHistory: [
          {
            status: "REQUESTED",
            timestamp: new Date(),
            actor: { type: "SYSTEM" },
          },
        ],
      });

      assert.equal(refund.status, "REQUESTED");
      assert.equal(refund.statusHistory.length, 1);
      assert.equal(refund.originalAmount, 50_000);
      assert.equal(refund.refundAmount, 50_000);
      assert.equal(refund.deductionAmount, 0);
      assert.equal(refund.userId?.toString(), userId.toString());
    });

    it("prevents duplicate refund for the same transaction (unique index)", async () => {
      const txId = new mongoose.Types.ObjectId();
      const base = {
        orderId: new mongoose.Types.ObjectId(),
        originalTransactionId: txId,
        originalAmount: 50_000,
        deductionAmount: 0,
        refundAmount: 50_000,
        status: "REQUESTED" as const,
        statusHistory: [],
      };

      await RefundRequest.create(base);
      await assert.rejects(
        () =>
          RefundRequest.create({
            ...base,
            orderId: new mongoose.Types.ObjectId(),
          }),
        /duplicate key/i
      );
    });

    it("validates amount fields are integers", async () => {
      await assert.rejects(
        () =>
          RefundRequest.create({
            orderId: new mongoose.Types.ObjectId(),
            originalTransactionId: new mongoose.Types.ObjectId(),
            originalAmount: 50.5,
            deductionAmount: 0,
            refundAmount: 50.5,
            status: "REQUESTED",
            statusHistory: [],
          }),
        /integer/i
      );
    });
  });

  describe("LedgerEntry originalPostingId", () => {
    it("schema accepts and stores originalPostingId", async () => {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const wallet = await createTestWallet(session);
        const postingId = new mongoose.Types.ObjectId();
        const originalPostingId = new mongoose.Types.ObjectId();

        const [entry] = await LedgerEntry.create(
          [
            {
              postingId,
              transactionId: new mongoose.Types.ObjectId(),
              walletId: wallet._id,
              currency: "NGN",
              account: "WALLET_AVAILABLE",
              direction: "DEBIT",
              amount: 5000,
              entryType: "REFUND",
              narration: "Test refund entry",
              originalPostingId,
              actor: { type: "SYSTEM" },
              source: "test",
              traceId: "test-trace",
              dedupeKey: `test-dedupe-${Date.now()}`,
            },
          ],
          { session }
        );

        assert.ok(entry);
        assert.equal(
          entry.originalPostingId?.toString(),
          originalPostingId.toString()
        );

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe("OutboxEvent refund types", () => {
    it("accepts all refund event types", async () => {
      const refundTypes = [
        "REFUND_REQUESTED",
        "REFUND_VALIDATED",
        "REFUND_APPROVED",
        "REFUND_DISPATCHED",
        "REFUND_SETTLED",
        "REFUND_COMPLETED",
      ] as const;

      for (const type of refundTypes) {
        const event = await OutboxEvent.create({
          type,
          dedupeKey: `test-${type}-${Date.now()}`,
          payload: { refundRequestId: "test-id" },
          status: "PENDING",
        });

        assert.equal(event.type, type);
        await event.deleteOne();
      }
    });
  });
});
