import mongoose from "mongoose";
import {
  Order,
  type IOrder,
  type IGuestContact,
  type OrderStatus,
  Cart,
  Product,
  Transaction,
  type ITransaction,
  type PaymentMethod,
} from "../models/index.js";
import { NotFoundError, ValidationError, FsmError } from "../utils/AppError.js";
import { InventoryService } from "./InventoryService.js";
import {
  ORDER_GUEST_MAX_ITEMS_TOTAL_KOBO,
  ORDER_GUEST_MAX_ITEMS_TOTAL_NGN,
  GUEST_INSTANT_PAYMENT_METHODS,
} from "../config/guestCheckout.js";

const GUEST_PAYMENT_SET = new Set<string>(GUEST_INSTANT_PAYMENT_METHODS);

function payableAmountKobo(order: {
  totalAmount: number;
  deliveryFee?: number;
}): number {
  return order.totalAmount + (order.deliveryFee ?? 0);
}

function isGuestOrder(order: {
  checkoutType?: string;
  user?: unknown;
}): boolean {
  return order.checkoutType === "GUEST" || order.user == null;
}

function normalizeGuestEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateGuestContact(contact: IGuestContact): IGuestContact {
  const email = normalizeGuestEmail(contact.email);
  const phone = contact.phone.trim().replace(/\s+/g, "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ValidationError("A valid guest email is required.");
  }
  if (!phone || phone.length < 10) {
    throw ValidationError(
      "A valid guest phone number is required (at least 10 digits).",
    );
  }
  return { email, phone };
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
};

function assertValidTransition(current: OrderStatus, next: OrderStatus): void {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw FsmError(current, next, allowed);
  }
}

type PaymentGatewayResult = {
  success: boolean;
  providerRef?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Placeholder for payment gateway integration.
 * For now this simulates an approved charge and returns provider metadata.
 */
async function chargeViaProvider(params: {
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  provider: string;
  providerRef?: string;
}): Promise<PaymentGatewayResult> {
  const result: PaymentGatewayResult = {
    success: true,
    metadata: {
      provider: params.provider,
      paymentMethod: params.paymentMethod,
      simulated: true,
    },
  };
  if (params.providerRef !== undefined) {
    result.providerRef = params.providerRef;
  }
  return result;
}

export class OrderService {
  static async createOrder(
    userId: string,
    idempotencyKey: string,
    shippingAddress: IOrder["shippingAddress"],
  ): Promise<IOrder> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const existingOrder = await Order.findOne({ idempotencyKey }).session(
        session,
      );
      if (existingOrder) {
        await session.abortTransaction();
        return existingOrder;
      }

      const cart = await Cart.findOne({ user: userId }).session(session);
      if (!cart || cart.items.length === 0) {
        throw ValidationError("Cart is empty.");
      }

      const orderItems = await Promise.all(
        cart.items.map(async (item) => {
          const product = await Product.findById(item.product).session(session);
          if (!product) throw NotFoundError("Product");
          if (!product.isActive) {
            throw ValidationError(`Product ${product.name} is not available.`);
          }

          await InventoryService.reserveStock(
            item.product.toString(),
            item.quantity,
            session,
          );

          const subtotal = product.price * item.quantity;

          return {
            product: item.product,
            productName: product.name,
            quantity: item.quantity,
            pricePerUnit: product.price,
            subtotal,
          };
        }),
      );

      const totalAmount = orderItems.reduce(
        (sum, item) => sum + item.subtotal,
        0,
      );

      const [order] = await Order.create(
        [
          {
            checkoutType: "REGISTERED" as const,
            user: userId,
            items: orderItems,
            totalAmount,
            deliveryFee: 0,
            status: "PENDING" as const,
            idempotencyKey,
            shippingAddress,
            statusHistory: [
              {
                status: "PENDING" as const,
                timestamp: new Date(),
                note: "Order created",
              },
            ],
          },
        ],
        { session },
      );

      if (!order) throw new Error("Failed to create order");

      cart.items = [];
      await cart.save({ session });

      await session.commitTransaction();
      return order.toObject() as IOrder;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Guest checkout: no user account. Line items are sent in the request (no cart).
   * Rules:
   * - Sum of item subtotals ≤ ORDER_GUEST_MAX_ITEMS_TOTAL_NGN (excludes deliveryFee).
   * - shippingAddress + guestContact (email, phone) required.
   * - Payment must be instant (see GUEST_INSTANT_PAYMENT_METHODS) via processPayment.
   */
  static async createGuestOrder(params: {
    idempotencyKey: string;
    shippingAddress: IOrder["shippingAddress"];
    guestContact: IGuestContact;
    items: { productId: string; quantity: number }[];
    deliveryFee?: number;
  }): Promise<IOrder> {
    const {
      idempotencyKey,
      shippingAddress,
      guestContact: rawContact,
      items,
      deliveryFee = 0,
    } = params;

    if (!items?.length) {
      throw ValidationError("At least one line item is required.");
    }
    if (deliveryFee < 0) {
      throw ValidationError("Delivery fee cannot be negative.");
    }

    const guestContact = validateGuestContact(rawContact);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const existingOrder = await Order.findOne({ idempotencyKey }).session(
        session,
      );
      if (existingOrder) {
        await session.commitTransaction();
        return existingOrder.toObject() as IOrder;
      }

      const orderItems = await Promise.all(
        items.map(async ({ productId, quantity }) => {
          if (!quantity || quantity < 1) {
            throw ValidationError("Each item must have quantity ≥ 1.");
          }

          const product = await Product.findById(productId).session(session);
          if (!product) throw NotFoundError("Product");
          if (!product.isActive) {
            throw ValidationError(`Product ${product.name} is not available.`);
          }

          await InventoryService.reserveStock(productId, quantity, session);

          const subtotal = product.price * quantity;

          return {
            product: product._id,
            productName: product.name,
            quantity,
            pricePerUnit: product.price,
            subtotal,
          };
        }),
      );

      const itemsSubtotal = orderItems.reduce((sum, row) => sum + row.subtotal, 0);

      if (itemsSubtotal > ORDER_GUEST_MAX_ITEMS_TOTAL_KOBO) {
        throw ValidationError(
          `Guest checkout item total exceeds the maximum allowed (NGN ${ORDER_GUEST_MAX_ITEMS_TOTAL_NGN} for items, delivery not included).`,
        );
      }

      const [order] = await Order.create(
        [
          {
            checkoutType: "GUEST" as const,
            guestContact,
            items: orderItems,
            totalAmount: itemsSubtotal,
            deliveryFee,
            status: "PENDING" as const,
            idempotencyKey,
            shippingAddress,
            statusHistory: [
              {
                status: "PENDING" as const,
                timestamp: new Date(),
                note: "Guest order created",
              },
            ],
          },
        ],
        { session },
      );

      if (!order) throw new Error("Failed to create order");

      await session.commitTransaction();
      return order.toObject() as IOrder;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async getOrderById(orderId: string): Promise<IOrder> {
    const order = await Order.findById(orderId).lean<IOrder>();
    if (!order) throw NotFoundError("Order");
    return order;
  }

  static async getUserOrders(userId: string): Promise<IOrder[]> {
    return Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean<IOrder[]>();
  }

  /** Public order lookup for guest orders — email must match stored guestContact. */
  static async getGuestOrderById(
    orderId: string,
    email: string,
  ): Promise<IOrder> {
    const order = await Order.findById(orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");
    if (order.checkoutType !== "GUEST") {
      throw ValidationError("This order is not a guest checkout.");
    }
    const normalized = normalizeGuestEmail(email);
    const stored = order.guestContact?.email;
    if (!stored || normalizeGuestEmail(stored) !== normalized) {
      throw NotFoundError("Order");
    }
    return order;
  }

  static async transitionStatus(
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
  ): Promise<IOrder> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      assertValidTransition(order.status, nextStatus);

      order.status = nextStatus;
      const historyEntry: {
        status: OrderStatus;
        timestamp: Date;
        note?: string;
      } = {
        status: nextStatus,
        timestamp: new Date(),
      };
      if (note) historyEntry.note = note;
      order.statusHistory.push(historyEntry);

      await order.save({ session });
      await session.commitTransaction();
      return order.toObject() as IOrder;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async confirmOrder(orderId: string): Promise<IOrder> {
    return OrderService.transitionStatus(
      orderId,
      "CONFIRMED",
      "Payment confirmed",
    );
  }

  static async shipOrder(orderId: string, note?: string): Promise<IOrder> {
    return OrderService.transitionStatus(orderId, "SHIPPED", note);
  }

  static async deliverOrder(orderId: string): Promise<IOrder> {
    return OrderService.transitionStatus(
      orderId,
      "DELIVERED",
      "Order delivered",
    );
  }

  static async cancelOrder(orderId: string, reason: string): Promise<IOrder> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      assertValidTransition(order.status, "CANCELLED");

      for (const item of order.items) {
        await InventoryService.releaseReservation(
          item.product.toString(),
          item.quantity,
          session,
        );
      }

      order.status = "CANCELLED";
      order.statusHistory.push({
        status: "CANCELLED",
        timestamp: new Date(),
        note: reason,
      });

      await order.save({ session });
      await session.commitTransaction();
      return order.toObject() as IOrder;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async failOrder(orderId: string, reason: string): Promise<IOrder> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      assertValidTransition(order.status, "FAILED");

      for (const item of order.items) {
        await InventoryService.releaseReservation(
          item.product.toString(),
          item.quantity,
          session,
        );
      }

      order.status = "FAILED";
      order.statusHistory.push({
        status: "FAILED",
        timestamp: new Date(),
        note: reason,
      });

      await order.save({ session });
      await session.commitTransaction();
      return order.toObject() as IOrder;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async processPayment(
    orderId: string,
    paymentMethod: PaymentMethod,
    provider: string,
    idempotencyKey: string,
    providerRef?: string,
  ): Promise<{ order: IOrder; transaction: ITransaction }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      if (order.status !== "PENDING") {
        throw ValidationError(
          `Cannot process payment for order with status ${order.status}.`,
        );
      }

      if (isGuestOrder(order)) {
        if (!GUEST_PAYMENT_SET.has(paymentMethod)) {
          throw ValidationError(
            "Guest checkout requires instant payment (card, USSD, bank transfer, or wallet). Cash on delivery or pay-in-store is not allowed.",
          );
        }
      }

      const chargeAmount = payableAmountKobo(order);
      if (chargeAmount < 1) {
        throw ValidationError("Order payable amount must be at least 1 kobo.");
      }

      const existingTx = await Transaction.findOne({
        idempotencyKey,
      }).session(session);
      if (existingTx) {
        await session.abortTransaction();
        return {
          order: order.toObject() as IOrder,
          transaction: existingTx,
        };
      }

      const transactionData: Record<string, unknown> = {
        order: orderId,
        amount: chargeAmount,
        currency: "NGN",
        status: "INITIATED" as const,
        paymentMethod,
        provider,
        idempotencyKey,
      };
      if (order.user) {
        transactionData.user = order.user;
      }
      if (providerRef !== undefined) transactionData.providerRef = providerRef;

      const [transaction] = await Transaction.create([transactionData], {
        session,
      });
      if (!transaction) throw new Error("Failed to create transaction");

      transaction.status = "PROCESSING";
      await transaction.save({ session });

      const gatewayPayload: Parameters<typeof chargeViaProvider>[0] = {
        amount: chargeAmount,
        currency: "NGN",
        paymentMethod,
        provider,
      };
      if (providerRef !== undefined) {
        gatewayPayload.providerRef = providerRef;
      }
      const gatewayResult = await chargeViaProvider(gatewayPayload);

      if (!gatewayResult.success) {
        transaction.status = "FAILED";
        transaction.failureReason =
          gatewayResult.failureReason ?? "Payment declined by provider.";
        if (gatewayResult.metadata !== undefined) {
          transaction.metadata = gatewayResult.metadata;
        }
        await transaction.save({ session });

        for (const item of order.items) {
          await InventoryService.releaseReservation(
            item.product.toString(),
            item.quantity,
            session,
          );
        }

        order.status = "FAILED";
        order.statusHistory.push({
          status: "FAILED",
          timestamp: new Date(),
          note: transaction.failureReason,
        });
      } else {
        transaction.status = "SUCCESS";
        transaction.paidAt = new Date();
        if (!transaction.providerRef && gatewayResult.providerRef) {
          transaction.providerRef = gatewayResult.providerRef;
        }
        if (gatewayResult.metadata !== undefined) {
          transaction.metadata = gatewayResult.metadata;
        }
        await transaction.save({ session });

        for (const item of order.items) {
          await InventoryService.commitReservation(
            item.product.toString(),
            item.quantity,
            session,
          );
        }

        order.status = "CONFIRMED";
        order.statusHistory.push({
          status: "CONFIRMED",
          timestamp: new Date(),
          note: "Payment successful",
        });
      }

      await order.save({ session });
      await session.commitTransaction();

      return {
        order: order.toObject() as IOrder,
        transaction: transaction.toObject() as ITransaction,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}
