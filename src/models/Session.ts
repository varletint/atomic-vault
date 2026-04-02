import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ISession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  isRevoked: boolean;
  revokedAt?: Date;
  revokeReason?: string;
  ip?: string;
  userAgent?: string;
  lastUsedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: { type: String, required: true },
    tokenFamilyId: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true },
    isRevoked: { type: Boolean, required: true, default: false, index: true },
    revokedAt: { type: Date, required: false, default: undefined },
    revokeReason: { type: String, required: false, default: undefined },
    ip: { type: String, required: false, default: undefined },
    userAgent: { type: String, required: false, default: undefined },
    lastUsedAt: { type: Date, required: false, default: undefined },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, createdAt: -1 });
sessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
sessionSchema.index({ tokenFamilyId: 1, isRevoked: 1 });

export const Session = mongoose.model<ISession>("Session", sessionSchema);

