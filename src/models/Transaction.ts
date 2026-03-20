import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Transaction Model
 * Tracks every payment attempt and its outcome for an order.
 *
 * Why separate from Order?
 * - An order may have MULTIPLE transactions (failed first attempt, retry, refund).
 * - Keeps payment concerns isolated from order lifecycle.
 * - Makes refund/audit trails trivial to query.
 *
 * Flow:
 *   INITIATED → PROCESSING → SUCCESS
 *                    ↓
 *                 FAILED
 *
 *   SUCCESS → REFUND_INITIATED → REFUNDED
 *
 * `providerRef` stores the external payment gateway's transaction ID
 * (e.g., Paystack reference, Flutterwave tx_ref) so you can reconcile.
 *
 * `idempotencyKey` ensures the same payment is never charged twice
 * even if your server retries the request to the payment provider.
 */

export type TransactionStatus =
  | "INITIATED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "REFUND_INITIATED"
  | "REFUNDED";

export type PaymentMethod =
  | "CARD"
  | "BANK_TRANSFER"
  | "WALLET"
  | "USSD"
  | "CASH_ON_DELIVERY"
  | "CASH_IN_STORE";

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  order: Types.ObjectId;
  /** Absent for guest checkout orders */
  user?: Types.ObjectId | null;
  amount: number; // in kobo
  currency: string;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  provider: string; // e.g., "paystack", "flutterwave"
  providerRef?: string; // external reference from payment gateway
  idempotencyKey: string;
  metadata?: Record<string, unknown>; // flexible store for gateway response data
  failureReason?: string;
  paidAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: undefined,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, "Amount must be at least 1 kobo"],
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "INITIATED",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "REFUND_INITIATED",
        "REFUNDED",
      ],
      default: "INITIATED",
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: [
        "CARD",
        "BANK_TRANSFER",
        "WALLET",
        "USSD",
        "CASH_ON_DELIVERY",
        "CASH_IN_STORE",
      ],
      required: true,
    },
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    providerRef: { type: String, sparse: true },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    metadata: { type: Schema.Types.Mixed },
    failureReason: { type: String },
    paidAt: { type: Date },
    refundedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Query indexes
transactionSchema.index({ order: 1 }); // all transactions for an order
transactionSchema.index({ user: 1, createdAt: -1 }); // user's payment history
transactionSchema.index({ status: 1 }); // find pending/failed transactions
transactionSchema.index({ providerRef: 1 }, { sparse: true }); // webhook reconciliation
transactionSchema.index({ idempotencyKey: 1 }, { unique: true }); // prevent duplicate charges

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);
