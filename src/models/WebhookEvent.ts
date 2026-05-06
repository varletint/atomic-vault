import mongoose, { Schema, type Document } from "mongoose";

export interface IWebhookEvent extends Document {
  provider: "PAYSTACK";
  event: string;
  payload: Record<string, unknown>;
  signature?: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";
  error?: string;
  processedAt?: Date;
  receivedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    provider: {
      type: String,
      required: true,
      enum: ["PAYSTACK"],
      default: "PAYSTACK",
    },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    signature: { type: String },
    status: {
      type: String,
      enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"],
      default: "RECEIVED",
    },
    error: { type: String },
    processedAt: { type: Date },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

webhookEventSchema.index({ event: 1, receivedAt: -1 });
webhookEventSchema.index({ status: 1 });
webhookEventSchema.index({ "payload.data.id": 1 });

export const WebhookEvent = mongoose.model<IWebhookEvent>(
  "WebhookEvent",
  webhookEventSchema
);
