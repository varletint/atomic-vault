import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Order Model
 * Represents a finalized purchase.
 *
 * This is the most critical model in the system. Every order transitions
 * through a strict state machine:
 *
 *   PENDING → CONFIRMED → SHIPPED → DELIVERED
 *       ↓         ↓
 *   CANCELLED  CANCELLED
 *       ↓         ↓
 *   (inventory   (inventory
 *    released)    released)
 *
 * PENDING:   Order created, inventory reserved, awaiting payment.
 * CONFIRMED: Payment succeeded, order is being prepared.
 * SHIPPED:   Order has left the warehouse.
 * DELIVERED: Customer received the order.
 * CANCELLED: Order was cancelled (inventory must be released).
 * FAILED:    Payment or processing failed (inventory must be released).
 *
 * The `idempotencyKey` field prevents duplicate orders if a customer
 * double-clicks the checkout button or retries due to network issues.
 */

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export type CheckoutType = "REGISTERED" | "GUEST";

export interface IGuestContact {
  email: string;
  phone: string;
}

export interface IOrderItem {
  product: Types.ObjectId;
  productName: string; // snapshot — product name could change later
  quantity: number;
  pricePerUnit: number; // in kobo, snapshot at time of order
  subtotal: number; // quantity * pricePerUnit
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  checkoutType: CheckoutType;
  /** Registered user id; unset for guest checkout */
  user?: Types.ObjectId | null;
  guestContact?: IGuestContact;
  items: IOrderItem[];
  /** Sum of line subtotals (items only), kobo — excludes deliveryFee */
  totalAmount: number;
  /** Delivery fee in kobo; not counted toward guest item cap */
  deliveryFee?: number;
  status: OrderStatus;
  idempotencyKey: string; // prevents duplicate order creation
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  statusHistory: {
    status: OrderStatus;
    timestamp: Date;
    note?: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: { type: String, required: true },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    pricePerUnit: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const statusHistorySchema = new Schema(
  {
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
    timestamp: { type: Date, default: Date.now },
    note: { type: String },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true, default: "NG" },
  },
  { _id: false }
);

const guestContactSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    checkoutType: {
      type: String,
      enum: ["REGISTERED", "GUEST"],
      default: "REGISTERED",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: undefined,
    },
    guestContact: {
      type: guestContactSchema,
      required: false,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [
        (val: IOrderItem[]) => val.length > 0,
        "Order must have at least one item",
      ],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0, "Total cannot be negative"],
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: [0, "Delivery fee cannot be negative"],
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
      default: "PENDING",
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    shippingAddress: { type: shippingAddressSchema, required: true },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for common queries
orderSchema.index({ user: 1, createdAt: -1 }); // user's order history
orderSchema.index({ status: 1 }); // filter by status (admin dashboard)
orderSchema.index({ idempotencyKey: 1 }, { unique: true }); // prevent duplicates
orderSchema.index({ checkoutType: 1, createdAt: -1 });
orderSchema.index(
  { "guestContact.email": 1, createdAt: -1 },
  { sparse: true },
);

export const Order = mongoose.model<IOrder>("Order", orderSchema);
