import mongoose, { Schema, type Document, type Types } from "mongoose";

export type AuditSeverity = "info" | "warning" | "error" | "critical";

/**
 * Keep this open-ended (string) so you can add actions without migrations.
 * Use a shared constants file later if you want stronger constraints.
 */
export type AuditAction = string;

export type AuditEntityType =
  | "User"
  | "Order"
  | "Transaction"
  | "Product"
  | "Cart"
  | "Inventory"
  | "TrackingEvent"
  | "OutboxEvent"
  | "System"
  | "Ledger"
  | "Wallet"
  | "Other";

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  action: AuditAction;
  actor: {
    userId?: Types.ObjectId;
    email?: string;
    role?: string;
    isSystem: boolean;
  };
  entity?: {
    type: AuditEntityType;
    id?: Types.ObjectId;
    name?: string;
  };
  changes?: {
    before?: unknown;
    after?: unknown;
    changedFields?: string[];
  };
  request?: {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    endpoint?: string;
    method?: string;
  };
  result?: {
    success: boolean;
    errorMessage?: string;
    errorCode?: string;
  };
  metadata?: Record<string, unknown>;
  severity: AuditSeverity;
  createdAt: Date;
  updatedAt: Date;
}

const auditActorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    email: { type: String, required: false, trim: true, lowercase: true },
    role: { type: String, required: false, trim: true },
    isSystem: { type: Boolean, required: true, default: false },
  },
  { _id: false }
);

const auditEntitySchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "User",
        "Order",
        "Transaction",
        "Product",
        "Cart",
        "Inventory",
        "TrackingEvent",
        "OutboxEvent",
        "System",
        "Ledger",
        "Wallet",
        "Other",
      ],
      required: true,
    },
    id: { type: Schema.Types.ObjectId, required: false },
    name: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const auditChangesSchema = new Schema(
  {
    before: { type: Schema.Types.Mixed, required: false },
    after: { type: Schema.Types.Mixed, required: false },
    changedFields: { type: [String], required: false, default: undefined },
  },
  { _id: false }
);

const auditRequestSchema = new Schema(
  {
    requestId: { type: String, required: false, trim: true },
    ipAddress: { type: String, required: false, trim: true },
    userAgent: { type: String, required: false, trim: true },
    endpoint: { type: String, required: false, trim: true },
    method: { type: String, required: false, trim: true, uppercase: true },
  },
  { _id: false }
);

const auditResultSchema = new Schema(
  {
    success: { type: Boolean, required: true, default: true },
    errorMessage: { type: String, required: false, trim: true },
    errorCode: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true, trim: true },
    actor: { type: auditActorSchema, required: true },
    entity: { type: auditEntitySchema, required: false, default: undefined },
    changes: { type: auditChangesSchema, required: false, default: undefined },
    request: { type: auditRequestSchema, required: false, default: undefined },
    result: { type: auditResultSchema, required: true, default: () => ({}) },
    metadata: { type: Schema.Types.Mixed, required: false, default: undefined },
    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      required: true,
      default: "info",
      index: true,
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ "actor.userId": 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ "entity.type": 1, "entity.id": 1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
