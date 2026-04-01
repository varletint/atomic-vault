import mongoose, { Schema, type Document, type Types } from "mongoose";

export type OrderDocumentType = "INVOICE_PDF";

export interface IOrderDocument extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  type: OrderDocumentType;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderDocumentSchema = new Schema<IOrderDocument>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["INVOICE_PDF"], required: true },
    storageKey: { type: String, required: true },
    contentType: { type: String, required: true, default: "application/pdf" },
    sizeBytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

orderDocumentSchema.index({ orderId: 1, type: 1 }, { unique: true });

export const OrderDocument = mongoose.model<IOrderDocument>(
  "OrderDocument",
  orderDocumentSchema
);

