import mongoose, { Schema, type Document, type Types } from "mongoose";

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
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer (kobo)",
      },
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
