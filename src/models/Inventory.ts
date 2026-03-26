import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Inventory Model
 * Tracks stock levels for each product.
 *
 * Separated from the Product model intentionally:
 * - Product = catalog data (name, price, description) — read-heavy, rarely changes.
 * - Inventory = stock count — write-heavy, changes on every purchase.
 *
 * This separation prevents write contention on the Product document
 * and is a key pattern for understanding why ACID matters:
 * the `stock` field is the most contested resource in the system.
 *
 * `reserved` tracks items that are locked for in-progress orders
 * but not yet paid for. Available stock = stock - reserved.
 *
 * `version` (__v) is used for Optimistic Concurrency Control (OCC)
 * to prevent overselling under concurrent requests.
 */
export interface IInventory extends Document {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  variant?: Types.ObjectId; // null = product-level stock (no variants)
  stock: number; // total physical stock
  reserved: number; // items reserved by pending orders
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
  },
  {
    timestamps: true,
    // Enable Mongoose's built-in optimistic concurrency control
    // This auto-increments __v on every save and rejects stale writes
    optimisticConcurrency: true,
  }
);

// One inventory record per product/variant combination
inventorySchema.index({ product: 1, variant: 1 }, { unique: true });

/**
 * Virtual: available stock = total stock - reserved items
 * This is the true number of items a customer can buy right now.
 */
inventorySchema.virtual("available").get(function (this: IInventory) {
  return this.stock - this.reserved;
});

export const Inventory = mongoose.model<IInventory>(
  "Inventory",
  inventorySchema
);
