import mongoose, { Schema, type Document, type Types } from "mongoose";

export type StockMovementType =
  | "INBOUND"
  | "OUTBOUND"
  | "RESERVE"
  | "RELEASE"
  | "COMMIT"
  | "ADJUSTMENT";

export interface IStockMovementReference {
  orderId?: Types.ObjectId;
  reason?: string;
}

export interface IStockMovement extends Document {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  variant?: Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  direction: 1 | -1;
  balanceAfter: number;
  reservedAfter: number;
  reference?: IStockMovementReference;
  performedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const stockMovementReferenceSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: false },
    reason: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const stockMovementSchema = new Schema<IStockMovement>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variant: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    type: {
      type: String,
      enum: [
        "INBOUND",
        "OUTBOUND",
        "RESERVE",
        "RELEASE",
        "COMMIT",
        "ADJUSTMENT",
      ],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    direction: {
      type: Number,
      enum: [1, -1],
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reservedAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      type: stockMovementReferenceSchema,
      required: false,
      default: undefined,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

stockMovementSchema.index({ product: 1, createdAt: -1 });
stockMovementSchema.index({ type: 1 });
stockMovementSchema.index({ "reference.orderId": 1 }, { sparse: true });

export const StockMovement = mongoose.model<IStockMovement>(
  "StockMovement",
  stockMovementSchema
);
