import mongoose, { Schema, type Document, type Types } from "mongoose";

export type TransactionStatus =
  | "INITIATED"
  | "RESERVED"
  | "PROCESSING"
  | "UNKNOWN"
  | "CONFIRMED"
  | "FAILED"
  | "REVERSED";

export type TransactionType =
  | "ORDER_PAYMENT"
  | "REFUND"
  | "PAYOUT"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "REVERSAL";

export type PaymentMethod =
  | "CARD"
  | "BANK_TRANSFER"
  | "WALLET"
  | "USSD"
  | "CASH_ON_DELIVERY"
  | "CASH_IN_STORE";

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  type: TransactionType;
  order: Types.ObjectId;
  /** Absent for guest checkout orders */
  user?: Types.ObjectId | null;
  amount: number;
  currency: string;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  provider: string;
  providerRef?: string;
  gatewayFee?: number;

  postedAt?: Date;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  failureReason?: string;
  paidAt?: Date;
  reversedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    type: {
      type: String,
      enum: [
        "ORDER_PAYMENT",
        "REFUND",
        "PAYOUT",
        "TRANSFER",
        "ADJUSTMENT",
        "REVERSAL",
      ],
      default: "ORDER_PAYMENT",
      required: true,
    },
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
        "RESERVED",
        "PROCESSING",
        "UNKNOWN",
        "CONFIRMED",
        "FAILED",
        "REVERSED",
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
    gatewayFee: {
      type: Number,
      min: [0, "Gateway fee cannot be negative"],
      validate: {
        validator: (v: unknown) =>
          v === undefined || (typeof v === "number" && Number.isInteger(v)),
        message: "Gateway fee must be an integer (kobo)",
      },
    },
    postedAt: { type: Date },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    metadata: { type: Schema.Types.Mixed },
    failureReason: { type: String },
    paidAt: { type: Date },
    reversedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

transactionSchema.index({ order: 1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ providerRef: 1 }, { sparse: true });
transactionSchema.index({ idempotencyKey: 1 }, { unique: true });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ postedAt: -1 }, { sparse: true });

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);
