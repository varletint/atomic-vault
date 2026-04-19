import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IWalletSnapshot extends Document {
  _id: Types.ObjectId;
  walletId: Types.ObjectId;
  asOf: Date;
  available: number;
  pending: number;
  currency: string;
  ledgerHead?: Types.ObjectId;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletSnapshotSchema = new Schema<IWalletSnapshot>(
  {
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    asOf: { type: Date, required: true },
    available: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Available must be an integer (kobo)",
      },
    },
    pending: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Pending must be an integer (kobo)",
      },
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: "NGN",
    },
    ledgerHead: {
      type: Schema.Types.ObjectId,
      ref: "LedgerEntry",
      required: false,
      default: undefined,
    },
    entryCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

walletSnapshotSchema.index({ walletId: 1, asOf: -1 });
walletSnapshotSchema.index({ walletId: 1, asOf: 1 }, { unique: true });

export const WalletSnapshot = mongoose.model<IWalletSnapshot>(
  "WalletSnapshot",
  walletSnapshotSchema
);
