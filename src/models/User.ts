import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * User Model
 * Represents a customer who can place orders.
 *
 * Lifecycle FSM:
 *   UNVERIFIED → ACTIVE → SUSPENDED → DEACTIVATED
 *                  ↓          ↓
 *              DEACTIVATED  ACTIVE
 *
 * UNVERIFIED:   Just registered, email not confirmed yet. Cannot place orders.
 * ACTIVE:       Email verified, full access to the platform.
 * SUSPENDED:    Temporarily restricted (fraud review, policy violation). Can log in, cannot transact.
 * DEACTIVATED:  Terminal state. Data preserved for audit, but user cannot log in or transact.
 */

export type UserStatus = "UNVERIFIED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

export interface IUserStatusHistoryEntry {
  status: UserStatus;
  timestamp: Date;
  reason?: string;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  status: UserStatus;
  isEmailVerified: boolean;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  statusHistory: IUserStatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true, default: "NIG" },
  },
  { _id: false }
);

const statusHistorySchema = new Schema(
  {
    status: {
      type: String,
      enum: ["UNVERIFIED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    reason: { type: String },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 8 },
    status: {
      type: String,
      enum: ["UNVERIFIED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
      default: "UNVERIFIED",
      required: true,
    },
    isEmailVerified: { type: Boolean, default: false },
    address: { type: addressSchema, required: true },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Index for fast email lookups
userSchema.index({ email: 1 });
// Index for filtering users by status (admin dashboard)
userSchema.index({ status: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
