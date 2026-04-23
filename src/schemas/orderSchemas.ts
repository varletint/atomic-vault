import { z } from "zod";

const shippingAddressSchema = z.object({
  street: z.string().min(1, "Street is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(1, "Zip is required"),
  country: z.string().min(1, "Country is required"),
});

const guestContactSchema = z.object({
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone must be at least 10 characters"),
});

const lineItemSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

const paymentMethods = [
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
  "USSD",
  "CASH_ON_DELIVERY",
  "CASH_IN_STORE",
] as const;

export const createOrderSchema = z.object({
  idempotencyKey: z.string().min(1, "Idempotency key is required"),
  shippingAddress: shippingAddressSchema,
});

export const createGuestOrderSchema = z.object({
  idempotencyKey: z.string().min(1, "Idempotency key is required"),
  shippingAddress: shippingAddressSchema,
  guestContact: guestContactSchema,
  items: z.array(lineItemSchema).min(1, "At least one item is required"),
  deliveryFee: z
    .number()
    .int("Delivery fee must be an integer (kobo)")
    .min(0, "Delivery fee cannot be negative")
    .max(10_000_000_000)
    .optional(),
});

export const processPaymentSchema = z.object({
  paymentMethod: z.enum(paymentMethods, {
    error: "Invalid payment method",
  }),
  provider: z.string().min(1, "Provider is required"),
  idempotencyKey: z.string().min(1, "Idempotency key is required"),
  callbackUrl: z.string().url("Invalid callback URL").optional(),
});

export const reasonSchema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export const noteSchema = z.object({
  note: z.string().optional(),
});

export const addTrackingEventSchema = z.object({
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
    "FAILED",
  ]),
  description: z.string().min(1, "Description is required"),
  location: z.string().optional(),
});

export const adminOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      "PENDING",
      "CONFIRMED",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "FAILED",
    ])
    .optional(),
  search: z.string().max(200).optional(),
  userId: z.string().min(1).optional(),
});

export const guestOrderQuerySchema = z.object({
  email: z.string().email("A valid email is required"),
});
// admin
// hey dont we need to know in productDetalisPage how many stock are sold, total amount of the stock per product,

// total amount of all products available

// do we need some type backend for this too
