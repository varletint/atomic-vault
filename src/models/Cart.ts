import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Cart Model
 * Represents a user's shopping cart before checkout.
 *
 * The cart is a temporary holding area. When the user clicks "Checkout",
 * the cart items are validated, an Order is created, inventory is reserved,
 * and the cart is cleared — all within a single ACID transaction.
 */

export interface ICartItem {
  product: Types.ObjectId;
  quantity: number;
  priceAtAdd: number; // price in cents when item was added (snapshot)
}

export interface ICart extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    priceAtAdd: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
  },
  { _id: false }
);

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one cart per user
    },
    items: { type: [cartItemSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

// Fast lookup by user
cartSchema.index({ user: 1 }, { unique: true });

export const Cart = mongoose.model<ICart>("Cart", cartSchema);
