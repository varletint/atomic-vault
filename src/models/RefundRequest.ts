import mongoose, { Schema, type Document, type Types } from "mongoose";

export const RefundStatus = {
  REQUESTED: "REQUESTED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  AWAITING_REVIEW: "AWAITING_REVIEW",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  GATEWAY_PENDING: "GATEWAY_PENDING",
  SETTLED: "SETTLED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

const REFUND_STATUS_VALUES = Object.values(RefundStatus);

export const ALLOWED_REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> =
  {
    REQUESTED: ["PENDING_APPROVAL", "REJECTED"],
    PENDING_APPROVAL: ["AWAITING_REVIEW", "PROCESSING"],
    AWAITING_REVIEW: ["PROCESSING", "REJECTED"],
    PROCESSING: ["GATEWAY_PENDING", "RETRYING", "FAILED"],
    RETRYING: ["PROCESSING", "FAILED"],
    GATEWAY_PENDING: ["SETTLED"],
    SETTLED: ["COMPLETED"],
    FAILED: ["PROCESSING"],
    REJECTED: [],
    COMPLETED: [],
  };

export const MAX_REQUEUE_COUNT = 3;

export interface IRefundStatusHistoryEntry {
  status: RefundStatus;
  timestamp: Date;
  note?: string;
  actor?: {
    type: "SYSTEM" | "ADMIN" | "USER";
    id?: Types.ObjectId;
  };
}

export interface IRefundRequest extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  userId?: Types.ObjectId | null;
  originalTransactionId: Types.ObjectId;
  refundTransactionId?: Types.ObjectId;
  originalAmount: number;
  deductionAmount: number;
  deductionReason?: string;
  refundAmount: number;
  status: RefundStatus;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  completedAt?: Date;
  providerRefundRef?: string;
  retryCount: number;
  requeueCount: number;
  lastError?: string;
  statusHistory: IRefundStatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const refundStatusHistorySchema = new Schema<IRefundStatusHistoryEntry>(
  {
    status: {
      type: String,
      enum: REFUND_STATUS_VALUES,
      required: true,
    },
    timestamp: { type: Date, default: Date.now, required: true },
    note: { type: String },
    actor: {
      type: new Schema(
        {
          type: {
            type: String,
            enum: ["SYSTEM", "ADMIN", "USER"],
            required: true,
          },
          id: { type: Schema.Types.ObjectId, required: false },
        },
        { _id: false }
      ),
      required: false,
    },
  },
  { _id: false }
);

const refundRequestSchema = new Schema<IRefundRequest>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: undefined,
      index: true,
    },
    originalTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    refundTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: false,
      default: undefined,
    },
    originalAmount: {
      type: Number,
      required: true,
      min: [1, "Original amount must be at least 1 kobo"],
      validate: {
        validator: Number.isInteger,
        message: "Original amount must be an integer (kobo)",
      },
    },
    deductionAmount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Deduction cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Deduction must be an integer (kobo)",
      },
    },
    deductionReason: { type: String, trim: true },
    refundAmount: {
      type: Number,
      required: true,
      min: [0, "Refund amount cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Refund amount must be an integer (kobo)",
      },
    },
    status: {
      type: String,
      enum: REFUND_STATUS_VALUES,
      required: true,
      default: "REQUESTED",
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: undefined,
    },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    completedAt: { type: Date },
    providerRefundRef: { type: String, unique: true, sparse: true },
    retryCount: { type: Number, required: true, default: 0, min: 0 },
    requeueCount: { type: Number, required: true, default: 0, min: 0 },
    lastError: { type: String },
    statusHistory: {
      type: [refundStatusHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

refundRequestSchema.index({ orderId: 1, createdAt: -1 });
refundRequestSchema.index({ status: 1, createdAt: -1 });
refundRequestSchema.index({ userId: 1, status: 1 });
refundRequestSchema.index({ originalTransactionId: 1 }, { unique: true });

export const RefundRequest = mongoose.model<IRefundRequest>(
  "RefundRequest",
  refundRequestSchema
);
