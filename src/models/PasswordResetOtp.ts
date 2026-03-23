import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Ephemeral password-reset challenge: one-time code sent by email.
 * Plain OTP is never stored; only a bcrypt hash. TTL on `expiresAt` removes stale rows.
 */

export interface IPasswordResetOtp extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetOtpSchema = new Schema<IPasswordResetOtp>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0, min: 0 },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

passwordResetOtpSchema.index({ userId: 1, usedAt: 1 });

export const PasswordResetOtp = mongoose.model<IPasswordResetOtp>(
  "PasswordResetOtp",
  passwordResetOtpSchema
);
