import mongoose, { Schema, type Document, type Types } from "mongoose";

export type SettlementStatus = "PENDING" | "RECONCILED" | "PARTIAL" | "FAILED";
export type SettlementItemMatch = "MATCHED" | "UNMATCHED" | "AMOUNT_MISMATCH";

export interface ISettlementItem {
  paystackRef: string;
  grossAmount: number;
  fee: number;
  netAmount: number;
  matchStatus: SettlementItemMatch;
  transactionId?: Types.ObjectId;
}

export interface ISettlement extends Document {
  _id: Types.ObjectId;
  paystackId: string;
  status: SettlementStatus;
  totalAmount: number;
  totalFees: number;
  netAmount: number;
  currency: string;
  settledAt: Date;
  reconciledAt?: Date;
  items: ISettlementItem[];
  unmatchedCount: number;
  mismatchCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const settlementItemSchema = new Schema<ISettlementItem>(
  {
    paystackRef: { type: String, required: true },
    grossAmount: { type: Number, required: true },
    fee: { type: Number, required: true, default: 0 },
    netAmount: { type: Number, required: true },
    matchStatus: {
      type: String,
      enum: ["MATCHED", "UNMATCHED", "AMOUNT_MISMATCH"],
      required: true,
      default: "UNMATCHED",
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: false,
      default: undefined,
    },
  },
  { _id: false }
);

const settlementSchema = new Schema<ISettlement>(
  {
    paystackId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "RECONCILED", "PARTIAL", "FAILED"],
      required: true,
      default: "PENDING",
    },
    totalAmount: { type: Number, required: true },
    totalFees: { type: Number, required: true, default: 0 },
    netAmount: { type: Number, required: true },
    currency: {
      type: String,
      required: true,
      default: "NGN",
      uppercase: true,
      trim: true,
    },
    settledAt: { type: Date, required: true },
    reconciledAt: { type: Date, required: false, default: undefined },
    items: { type: [settlementItemSchema], default: [] },
    unmatchedCount: { type: Number, required: true, default: 0 },
    mismatchCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

settlementSchema.index({ status: 1 });
settlementSchema.index({ settledAt: -1 });

export const Settlement = mongoose.model<ISettlement>(
  "Settlement",
  settlementSchema
);
