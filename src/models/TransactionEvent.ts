import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { TransactionStatus } from "./Transaction.js";

export type ActorType = "SYSTEM" | "ADMIN" | "USER";

export interface IActorRef {
  type: ActorType;
  id?: Types.ObjectId;
}

export interface ITransactionEvent extends Document {
  _id: Types.ObjectId;
  transactionId: Types.ObjectId;
  previousStatus: TransactionStatus;
  newStatus: TransactionStatus;
  reason: string;
  actor: IActorRef;
  source: string;
  traceId: string;
  metadata?: Record<string, unknown>;
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

const transactionEventSchema = new Schema<ITransactionEvent>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    previousStatus: {
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
      required: true,
    },
    newStatus: {
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
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    actor: { type: actorSchema, required: true },
    source: { type: String, required: true, trim: true },
    traceId: { type: String, required: true, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

transactionEventSchema.index({ transactionId: 1, createdAt: 1 });
transactionEventSchema.index({ traceId: 1 });

export const TransactionEvent = mongoose.model<ITransactionEvent>(
  "TransactionEvent",
  transactionEventSchema
);
