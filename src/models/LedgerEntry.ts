import mongoose, { Schema, type Document, type Types } from "mongoose";

export type LedgerBucket = "AVAILABLE" | "PENDING";
export type LedgerDirection = "DEBIT" | "CREDIT";
export type LedgerEntryType =
  | "PAYMENT"
  | "FEE"
  | "REFUND"
  | "REVERSAL"
  | "TRANSFER"
  | "ADJUSTMENT";

export type ActorType = "SYSTEM" | "ADMIN" | "USER";

export interface IActorRef {
  type: ActorType;
  id?: Types.ObjectId;
}

export interface ILedgerEntryAttrs {
  transactionId: Types.ObjectId;
  walletId: Types.ObjectId;
  currency: string;
  bucket: LedgerBucket;
  direction: LedgerDirection;
  amount: number; 
  entryType: LedgerEntryType;
  narration?: string;
  actor: IActorRef;
  source: string;
  traceId: string;
  dedupeKey?: string;
  balanceAfterAvailable?: number;
  balanceAfterPending?: number;
}

export interface ILedgerEntry extends Document, ILedgerEntryAttrs {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const actorSchema = new Schema<IActorRef>(
  {
    type: {
      type: String,
      enum: ["SYSTEM", "ADMIN", "USER"],
      required: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      required: false,
      default: undefined,
    },
  },
  { _id: false }
);

const ledgerEntrySchema = new Schema<ILedgerEntry>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
      uppercase: true,
      trim: true,
    },
    bucket: {
      type: String,
      enum: ["AVAILABLE", "PENDING"],
      required: true,
      default: "AVAILABLE",
    },
    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, "Ledger amount must be at least 1 kobo"],
      validate: {
        validator: Number.isInteger,
        message: "Ledger amount must be an integer (kobo)",
      },
    },
    entryType: {
      type: String,
      enum: ["PAYMENT", "FEE", "REFUND", "REVERSAL", "TRANSFER", "ADJUSTMENT"],
      required: true,
    },
    narration: { type: String, trim: true },
    actor: { type: actorSchema, required: true },
    source: { type: String, required: true, trim: true },
    traceId: { type: String, required: true, trim: true },
    dedupeKey: { type: String, required: false, default: undefined },
    balanceAfterAvailable: {
      type: Number,
      min: [0, "Balance after (available) cannot be negative"],
      validate: {
        validator: (v: unknown) =>
          v === undefined || (typeof v === "number" && Number.isInteger(v)),
        message: "Balance after (available) must be an integer (kobo)",
      },
    },
    balanceAfterPending: {
      type: Number,
      min: [0, "Balance after (pending) cannot be negative"],
      validate: {
        validator: (v: unknown) =>
          v === undefined || (typeof v === "number" && Number.isInteger(v)),
        message: "Balance after (pending) must be an integer (kobo)",
      },
    },
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ walletId: 1, createdAt: 1 });
ledgerEntrySchema.index({ transactionId: 1, createdAt: 1 });
ledgerEntrySchema.index(
  { walletId: 1, dedupeKey: 1 },
  { unique: true, sparse: true }
);

export const LedgerEntry = mongoose.model<ILedgerEntry>(
  "LedgerEntry",
  ledgerEntrySchema
);

