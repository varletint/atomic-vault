import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { OrderStatus } from "./Order.js";

export interface ITrackingEvent extends Document {
  orderId: Types.ObjectId;
  status: OrderStatus;
  location?: string;
  description: string;
  timestamp: Date;
}

const trackingEventSchema = new Schema<ITrackingEvent>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "FAILED",
      ],
      required: true,
    },
    location: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Sort by timestamp descending so the newest event is first
trackingEventSchema.index({ orderId: 1, timestamp: -1 });

export const TrackingEvent = mongoose.model<ITrackingEvent>(
  "TrackingEvent",
  trackingEventSchema
);
