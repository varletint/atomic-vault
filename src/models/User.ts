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
export type UserRole = "CUSTOMER" | "SUPPORT" | "ADMIN";

export interface IUserStatusHistoryEntry {
  status: UserStatus;
  timestamp: Date;
  reason?: string;
  actorId?: string;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  auth: {
    failedLoginAttempts: number;
    lockedUntil?: Date;
    lastLoginAt?: Date;
    lastLoginIp?: string;
    lastLoginDevice?: string;
    passwordChangedAt?: Date;
    tokenVersion: number;
    mfa: {
      enabled: boolean;
      method?: "NONE" | "TOTP" | "SMS" | "EMAIL";
      secretRef?: string;
      backupCodesHash: string[];
    };
  };
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  deactivatedAt?: Date;
  deactivatedBy?: string;
  suspendedUntil?: Date;
  consents: {
    type: "TERMS" | "PRIVACY" | "MARKETING";
    version: string;
    grantedAt: Date;
    revokedAt?: Date;
  }[];
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
    actorId: { type: String },
  },
  { _id: false }
);

const mfaSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    method: {
      type: String,
      enum: ["NONE", "TOTP", "SMS", "EMAIL"],
      default: "NONE",
    },
    secretRef: { type: String },
    backupCodesHash: { type: [String], default: [] },
  },
  { _id: false }
);

const authSchema = new Schema(
  {
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    lastLoginDevice: { type: String },
    passwordChangedAt: { type: Date },
    tokenVersion: { type: Number, default: 0, min: 0 },
    mfa: { type: mfaSchema, default: () => ({}) },
  },
  { _id: false }
);

const consentSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["TERMS", "PRIVACY", "MARKETING"],
      required: true,
    },
    version: { type: String, required: true, trim: true },
    grantedAt: { type: Date, required: true, default: Date.now },
    revokedAt: { type: Date },
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
    password: { type: String, required: true, minlength: 8, select: false },
    role: {
      type: String,
      enum: ["CUSTOMER", "SUPPORT", "ADMIN"],
      default: "CUSTOMER",
      required: true,
    },
    status: {
      type: String,
      enum: ["UNVERIFIED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
      default: "UNVERIFIED",
      required: true,
    },
    isEmailVerified: { type: Boolean, default: false },
    auth: { type: authSchema, default: () => ({}) },
    address: { type: addressSchema, required: true },
    deactivatedAt: { type: Date },
    deactivatedBy: { type: String },
    suspendedUntil: { type: Date },
    consents: { type: [consentSchema], default: [] },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.password;
        return ret;
      },
    },
  }
);

userSchema.pre("save", function normalizeAndAlign(this: IUser) {
  this.email = this.email.toLowerCase().trim();
  if (this.status === "ACTIVE" && !this.isEmailVerified) {
    this.isEmailVerified = true;
  }
  if (this.status === "DEACTIVATED" && !this.deactivatedAt) {
    this.deactivatedAt = new Date();
  }
});

// Index for fast email lookups
userSchema.index({ email: 1 });
// Index for filtering users by status (admin dashboard)
userSchema.index({ status: 1 });
// Compound index for common role + status admin queries
userSchema.index({ role: 1, status: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
