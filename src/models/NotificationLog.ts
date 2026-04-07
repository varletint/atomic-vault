import mongoose, { Schema, type Document, type Types } from "mongoose";

export type NotificationChannel = "EMAIL";
export type NotificationType = "ORDER_CONFIRMED" | "ORDER_DELIVERED";
export type NotificationStatus = "SENT" | "FAILED";

export interface INotificationLog extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  type: NotificationType;
  channel: NotificationChannel;
  to: string;
  status: NotificationStatus;
  provider?: string;
  providerMessageId?: string;
  attempt: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["ORDER_CONFIRMED", "ORDER_DELIVERED"],
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["EMAIL"],
      required: true,
    },
    to: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: ["SENT", "FAILED"], required: true },
    provider: { type: String },
    providerMessageId: { type: String },
    attempt: { type: Number, required: true, min: 1 },
    error: { type: String },
  },
  { timestamps: true }
);

notificationLogSchema.index(
  { orderId: 1, type: 1, channel: 1, status: 1, createdAt: -1 },
  { name: "order_notification_history" }
);

export const NotificationLog = mongoose.model<INotificationLog>(
  "NotificationLog",
  notificationLogSchema
);
