import mongoose, { Schema, type Document, type Types } from "mongoose";

export type OutboxStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export type OutboxEventType =
  | "ORDER_CONFIRMED"
  | "ORDER_DELIVERED"
  | "ORDER_SHIPPED"
  | "ORDER_CANCELLED"
  | "INVENTORY_LOW_STOCK"
  | "TRANSACTION_POSTED"
  | "WALLET_UPDATED"
  | "WITHDRAWAL_RESERVED";

export type OutboxPayloadMap = {
  ORDER_CONFIRMED: { orderId: string; paymentReference?: string };
  ORDER_DELIVERED: { orderId: string };
  ORDER_SHIPPED: { orderId: string; note?: string };
  ORDER_CANCELLED: { orderId: string; reason?: string };
  INVENTORY_LOW_STOCK: {
    productId: string;
    stock: number;
    reserved: number;
    available: number;
    threshold: number;
  };
  TRANSACTION_POSTED: Record<string, unknown>;
  WALLET_UPDATED: Record<string, unknown>;
  WITHDRAWAL_RESERVED: {
    transactionId: string;
    walletId: string;
    amount: number;
    currency: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    reason: string;
  };
};

export interface IOutboxEvent extends Document {
  _id: Types.ObjectId;
  type: OutboxEventType;
  dedupeKey: string;
  payload: OutboxPayloadMap[OutboxEventType];
  status: OutboxStatus;
  attempts: number;
  nextRunAt: Date;
  lockedAt?: Date;
  lockId?: string;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const outboxEventSchema = new Schema<IOutboxEvent>(
  {
    type: {
      type: String,
      enum: [
        "ORDER_CONFIRMED",
        "ORDER_DELIVERED",
        "ORDER_SHIPPED",
        "ORDER_CANCELLED",
        "INVENTORY_LOW_STOCK",
        "TRANSACTION_POSTED",
        "WALLET_UPDATED",
        "WITHDRAWAL_RESERVED",
      ],
      required: true,
      index: true,
    },
    dedupeKey: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "DONE", "FAILED"],
      required: true,
      default: "PENDING",
      index: true,
    },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    nextRunAt: { type: Date, required: true, default: Date.now, index: true },
    lockedAt: { type: Date, required: false, default: undefined },
    lockId: { type: String, required: false, default: undefined },
    lastError: { type: String, required: false, default: undefined },
    completedAt: { type: Date, required: false, default: undefined },
  },
  { timestamps: true }
);

outboxEventSchema.index({ type: 1, dedupeKey: 1 }, { unique: true });
outboxEventSchema.index({ status: 1, nextRunAt: 1 });
outboxEventSchema.index({ lockedAt: 1 }, { sparse: true });
outboxEventSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, sparse: true }
);

export const OutboxEvent = mongoose.model<IOutboxEvent>(
  "OutboxEvent",
  outboxEventSchema
);
