import mongoose, { Schema, type Document, type Types } from "mongoose";

export type WalletOwnerType = "USER" | "STORE" | "VENDOR";
export type WalletStatus = "ACTIVE" | "FROZEN";

export interface IWallet extends Document {
  _id: Types.ObjectId;
  ownerType: WalletOwnerType;
  ownerId: Types.ObjectId;
  currency: string;
  available: number; 
  pending: number; 
  status: WalletStatus;
  createdAt: Date;
  updatedAt: Date;
}

function isIntegerKobo(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v);
}

const walletSchema = new Schema<IWallet>(
  {
    ownerType: {
      type: String,
      enum: ["USER", "STORE", "VENDOR"],
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
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
    available: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Available balance cannot be negative"],
      validate: {
        validator: isIntegerKobo,
        message: "Available balance must be an integer (kobo)",
      },
    },
    pending: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Pending balance cannot be negative"],
      validate: {
        validator: isIntegerKobo,
        message: "Pending balance must be an integer (kobo)",
      },
    },
    status: {
      type: String,
      enum: ["ACTIVE", "FROZEN"],
      required: true,
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

walletSchema.index(
  { ownerType: 1, ownerId: 1, currency: 1 },
  { unique: true }
);
walletSchema.index({ status: 1 });

export const Wallet = mongoose.model<IWallet>("Wallet", walletSchema);

