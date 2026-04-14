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
  variant?: Types.ObjectId;
  variantLabel?: string;
  productName: string;
  productSku?: string;
  productImage?: string;
  productSlug?: string;
  quantity: number;
  pricePerUnit: number;
  subtotal: number;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  checkoutType: CheckoutType;
  user?: Types.ObjectId | null;
  guestContact?: IGuestContact;
  items: IOrderItem[];
  totalAmount: number;
  deliveryFee?: number;
  payment?: {
    provider?: string;
    reference?: string;
    amountPaid?: number;
    gatewayFee?: number;
    paidAt?: Date;
  };
  status: OrderStatus;
  idempotencyKey: string;
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
    variant: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    variantLabel: { type: String },
    productName: { type: String, required: true },
    productSku: { type: String },
    productImage: { type: String },
    productSlug: { type: String },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    pricePerUnit: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Price per unit must be an integer (kobo)",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Subtotal must be an integer (kobo)",
      },
    },
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
  { _id: false }
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
      validate: {
        validator: Number.isInteger,
        message: "Total amount must be an integer (kobo)",
      },
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: [0, "Delivery fee cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Delivery fee must be an integer (kobo)",
      },
    },
    payment: {
      provider: { type: String },
      reference: { type: String },
      amountPaid: {
        type: Number,
        min: [0, "Amount paid cannot be negative"],
        validate: {
          validator: (v: number | undefined) =>
            v === undefined || Number.isInteger(v),
          message: "Amount paid must be an integer (kobo)",
        },
      },
      gatewayFee: {
        type: Number,
        min: [0, "Gateway fee cannot be negative"],
        validate: {
          validator: (v: number | undefined) =>
            v === undefined || Number.isInteger(v),
          message: "Gateway fee must be an integer (kobo)",
        },
      },
      paidAt: { type: Date },
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

orderSchema.virtual("netAmount").get(function netAmount() {
  const amountPaid = this.payment?.amountPaid ?? 0;
  const gatewayFee = this.payment?.gatewayFee ?? 0;
  return Math.max(0, amountPaid - gatewayFee);
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ idempotencyKey: 1 }, { unique: true });
orderSchema.index({ checkoutType: 1, createdAt: -1 });
orderSchema.index({ "guestContact.email": 1, createdAt: -1 }, { sparse: true });

export const Order = mongoose.model<IOrder>("Order", orderSchema);
