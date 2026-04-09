import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IInventory extends Document {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  variant?: Types.ObjectId;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  version: number;
}

const inventorySchema = new Schema<IInventory>(
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
    stock: {
      type: Number,
      required: true,
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    reserved: {
      type: Number,
      required: true,
      min: [0, "Reserved cannot be negative"],
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      required: true,
      min: [0, "Threshold cannot be negative"],
      default: 3,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

inventorySchema.index({ product: 1, variant: 1 }, { unique: true });

inventorySchema.virtual("available").get(function (this: IInventory) {
  return this.stock - this.reserved;
});

export const Inventory = mongoose.model<IInventory>(
  "Inventory",
  inventorySchema
);
