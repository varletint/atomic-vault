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
  type TransactionStatus,
  type PaymentMethod,
  User,
  TrackingEvent,
  type ITrackingEvent,
} from "../models/index.js";
import { NotFoundError, ValidationError, FsmError } from "../utils/AppError.js";
import { InventoryService } from "./InventoryService.js";
import { resolveGateway, type ChargeParams } from "../payments/index.js";
import { OutboxProcessor } from "./OutboxProcessor.js";
import { OutboxService } from "./OutboxService.js";
import { LedgerService } from "./LedgerService.js";
import { TransactionEventService } from "./TransactionEventService.js";
import { withRetryableTransaction } from "../utils/withRetryableTransaction.js";
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
      "A valid guest phone number is required (at least 10 digits)."
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

const ALLOWED_TX_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  INITIATED: ["RESERVED", "FAILED"],
  RESERVED: ["PROCESSING", "FAILED"],
  PROCESSING: ["UNKNOWN", "CONFIRMED", "FAILED"],
  UNKNOWN: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["REVERSED"],
  FAILED: [],
  REVERSED: [],
};

function assertValidTxTransition(
  current: TransactionStatus,
  next: TransactionStatus
): void {
  const allowed = ALLOWED_TX_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw FsmError(current, next, allowed);
  }
}

async function resolveCustomerEmail(order: IOrder): Promise<string> {
  if (order.guestContact?.email) {
    return order.guestContact.email;
  }

  if (order.user) {
    const user = await User.findById(order.user).select("email").lean();
    if (user?.email) return user.email;
  }

  throw ValidationError("Cannot resolve customer email for payment.");
}

export class OrderService {
  static async createOrder(
    userId: string,
    idempotencyKey: string,
    shippingAddress: IOrder["shippingAddress"]
  ): Promise<IOrder> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const existingOrder = await Order.findOne({ idempotencyKey }).session(
        session
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
            session
          );

          const subtotal = product.price * item.quantity;

          const primaryImage =
            product.images?.find((img) => img.isPrimary)?.url ??
            product.images?.[0]?.url;

          return {
            product: item.product,
            productName: product.name,
            productSku: product.sku,
            productImage: primaryImage,
            productSlug: product.slug,
            quantity: item.quantity,
            pricePerUnit: product.price,
            subtotal,
          };
        })
      );

      const totalAmount = orderItems.reduce(
        (sum, item) => sum + item.subtotal,
        0
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
        { session }
      );

      if (!order) throw new Error("Failed to create order");

      await TrackingEvent.create(
        [
          {
            orderId: order._id,
            status: "PENDING",
            description: "Order created",
          },
        ],
        { session }
      );

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
        session
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

          const primaryImage =
            product.images?.find((img) => img.isPrimary)?.url ??
            product.images?.[0]?.url;

          return {
            product: product._id,
            productName: product.name,
            productSku: product.sku,
            productImage: primaryImage,
            productSlug: product.slug,
            quantity,
            pricePerUnit: product.price,
            subtotal,
          };
        })
      );

      const itemsSubtotal = orderItems.reduce(
        (sum, row) => sum + row.subtotal,
        0
      );

      if (itemsSubtotal > ORDER_GUEST_MAX_ITEMS_TOTAL_KOBO) {
        throw ValidationError(
          `Guest checkout item total exceeds the maximum allowed (NGN ${ORDER_GUEST_MAX_ITEMS_TOTAL_NGN} for items, delivery not included).`
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
        { session }
      );

      if (!order) throw new Error("Failed to create order");

      await TrackingEvent.create(
        [
          {
            orderId: order._id,
            status: "PENDING",
            description: "Guest order created",
          },
        ],
        { session }
      );

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

  static async getUserOrders(
    userId: string,
    page = 1,
    limit = 20
  ): Promise<{
    orders: IOrder[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IOrder[]>(),
      Order.countDocuments({ user: userId }),
    ]);

    return {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getAllOrders(
    page = 1,
    limit = 20,
    status?: OrderStatus,
    search?: string,
    userId?: string
  ): Promise<{
    orders: IOrder[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (userId) filter.user = userId;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { _id: { $regex: escaped, $options: "i" } },
        { "items.productName": { $regex: escaped, $options: "i" } },
        { "guestContact.email": { $regex: escaped, $options: "i" } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name email")
        .lean<IOrder[]>(),
      Order.countDocuments(filter),
    ]);

    return {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getGuestOrderById(
    orderId: string,
    email: string
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
    note?: string
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

      await TrackingEvent.create(
        [
          {
            orderId: order._id,
            status: nextStatus,
            description: note || `Order marked as ${nextStatus}`,
          },
        ],
        { session }
      );

      await order.save({ session });
      await session.commitTransaction();

      if (nextStatus === "DELIVERED") {
        await OutboxService.enqueue({
          type: "ORDER_DELIVERED",
          dedupeKey: `order:${orderId}:delivered`,
          payload: { orderId },
        });
        OutboxProcessor.scheduleDrain();
      } else if (nextStatus === "CONFIRMED") {
        await OutboxService.enqueue({
          type: "ORDER_CONFIRMED",
          dedupeKey: `order:${orderId}:confirmed`,
          payload: { orderId },
        });
        OutboxProcessor.scheduleDrain();
      } else if (nextStatus === "SHIPPED") {
        await OutboxService.enqueue({
          type: "ORDER_SHIPPED",
          dedupeKey: `order:${orderId}:shipped`,
          payload: { orderId, note },
        });
        OutboxProcessor.scheduleDrain();
      }

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
      "Payment confirmed"
    );
  }

  static async shipOrder(orderId: string, note?: string): Promise<IOrder> {
    return OrderService.transitionStatus(orderId, "SHIPPED", note);
  }

  static async deliverOrder(orderId: string): Promise<IOrder> {
    return OrderService.transitionStatus(
      orderId,
      "DELIVERED",
      "Order delivered"
    );
  }

  static async cancelOrder(orderId: string, reason: string): Promise<IOrder> {
    const order = await withRetryableTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      if (order.status === "CANCELLED") return order;

      const previousStatus = order.status;

      assertValidTransition(order.status, "CANCELLED");

      const items = order.items.map((i) => ({
        productId: i.product.toString(),
        quantity: i.quantity,
      }));

      if (previousStatus === "PENDING") {
        await InventoryService.bulkReleaseReservations(items, session);
      } else {
        await InventoryService.bulkRestoreCommittedStock(items, session);
      }

      order.applyCancellation(reason);

      await TrackingEvent.create(
        [
          {
            orderId: order._id,
            status: "CANCELLED",
            description: reason,
          },
        ],
        { session }
      );

      await OutboxService.enqueue(
        {
          type: "ORDER_CANCELLED",
          dedupeKey: `order:${orderId}:cancelled`,
          payload: { orderId, reason },
        },
        session
      );

      await order.save({ session });
      return order;
    });

    OutboxProcessor.scheduleDrain();
    return order.toObject() as IOrder;
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
          session
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
    callbackUrl?: string
  ): Promise<{
    order: IOrder;
    transaction: ITransaction;
    authorizationUrl: string;
  }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw NotFoundError("Order");

      if (order.status !== "PENDING") {
        throw ValidationError(
          `Cannot process payment for order with status ${order.status}.`
        );
      }

      if (isGuestOrder(order)) {
        if (!GUEST_PAYMENT_SET.has(paymentMethod)) {
          throw ValidationError(
            "Guest checkout requires instant payment (card, USSD, bank transfer, or wallet). Cash on delivery or pay-in-store is not allowed."
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
        const gateway = resolveGateway(provider);
        const initParams: ChargeParams = {
          email: await resolveCustomerEmail(order.toObject() as IOrder),
          amount: chargeAmount,
          currency: "NGN",
          reference: idempotencyKey,
          paymentMethod,
        };
        if (callbackUrl) initParams.callbackUrl = callbackUrl;
        const initResult = await gateway.initialize(initParams);
        return {
          order: order.toObject() as IOrder,
          transaction: existingTx,
          authorizationUrl: initResult.authorizationUrl,
        };
      }

      const customerEmail = await resolveCustomerEmail(
        order.toObject() as IOrder
      );

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

      const [transaction] = await Transaction.create([transactionData], {
        session,
      });
      if (!transaction) throw new Error("Failed to create transaction");

      const gateway = resolveGateway(provider);
      const chargeParams: ChargeParams = {
        email: customerEmail,
        amount: chargeAmount,
        currency: "NGN",
        reference: idempotencyKey,
        paymentMethod,
        metadata: {
          orderId,
          transactionId: transaction._id.toString(),
        },
      };
      if (callbackUrl) chargeParams.callbackUrl = callbackUrl;

      const initResult = await gateway.initialize(chargeParams);

      transaction.status = "PROCESSING";
      transaction.providerRef = initResult.providerRef;
      await transaction.save({ session });

      await session.commitTransaction();

      return {
        order: order.toObject() as IOrder,
        transaction: transaction.toObject() as ITransaction,
        authorizationUrl: initResult.authorizationUrl,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async verifyPayment(
    reference: string
  ): Promise<{ order: IOrder; transaction: ITransaction }> {
    const claimed = await Transaction.findOneAndUpdate(
      {
        idempotencyKey: reference,
        status: { $nin: ["CONFIRMED", "FAILED", "UNKNOWN"] },
      },
      { $set: { status: "UNKNOWN" } },
      { new: true }
    );

    if (!claimed) {
      const existing = await Transaction.findOne({
        idempotencyKey: reference,
      });
      if (!existing) throw NotFoundError("Transaction");

      const order = await Order.findById(existing.order).lean<IOrder>();
      if (!order) throw NotFoundError("Order");
      return { order, transaction: existing };
    }

    const gateway = resolveGateway(claimed.provider);
    const result = await gateway.verify(reference);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      /* Re-fetch claimed inside the session for snapshot isolation */
      const freshClaimed = await Transaction.findById(claimed._id).session(
        session
      );
      if (!freshClaimed) throw NotFoundError("Transaction");

      const order = await Order.findById(freshClaimed.order).session(session);
      if (!order) throw NotFoundError("Order");

      if (result.success) {
        assertValidTransition(order.status, "CONFIRMED");
        assertValidTxTransition(freshClaimed.status, "CONFIRMED");

        const amountPaid =
          typeof result.amountPaid === "number"
            ? result.amountPaid
            : freshClaimed.amount;
        const gatewayFee =
          typeof result.gatewayFee === "number" ? result.gatewayFee : 0;

        freshClaimed.status = "CONFIRMED";
        freshClaimed.paidAt = result.paidAt
          ? new Date(result.paidAt)
          : new Date();
        freshClaimed.gatewayFee = gatewayFee;
        if (result.metadata) freshClaimed.metadata = result.metadata;
        await freshClaimed.save({ session });

        await TransactionEventService.record({
          session,
          transactionId: freshClaimed._id.toString(),
          previousStatus: "UNKNOWN",
          newStatus: "CONFIRMED",
          reason: "payment_confirmed",
          actor: { type: "SYSTEM" },
          source: "payment:verify",
          traceId: `pay:${reference}`,
          metadata: { providerRef: result.providerRef },
        });

        for (const item of order.items) {
          await InventoryService.commitReservation(
            item.product.toString(),
            item.quantity,
            session
          );
        }

        order.status = "CONFIRMED";
        order.statusHistory.push({
          status: "CONFIRMED",
          timestamp: new Date(),
          note: "Payment verified successfully",
        });

        order.payment = {
          provider: freshClaimed.provider,
          reference: result.providerRef,
          amountPaid,
          gatewayFee,
          paidAt: freshClaimed.paidAt,
        };

        await LedgerService.postStoreOrderPayment({
          session,
          transactionId: freshClaimed._id.toString(),
          currency: freshClaimed.currency,
          amountPaid,
          gatewayFee,
          actor: { type: "SYSTEM" },
          source: "paystack:verify",
          traceId: `pay:${reference}`,
        });

        await TrackingEvent.create(
          [
            {
              orderId: order._id,
              status: "CONFIRMED",
              description: "Payment verified successfully",
            },
          ],
          { session }
        );

        await OutboxService.enqueue(
          {
            type: "ORDER_CONFIRMED",
            dedupeKey: `order:${order._id.toString()}:confirmed`,
            payload: {
              orderId: order._id.toString(),
              transactionId: freshClaimed._id.toString(),
              paymentReference: reference,
            },
          },
          session
        );
      } else {
        assertValidTransition(order.status, "FAILED");
        assertValidTxTransition(freshClaimed.status, "FAILED");

        freshClaimed.status = "FAILED";
        freshClaimed.failureReason =
          result.failureReason ?? "Payment declined by provider.";
        if (result.metadata) freshClaimed.metadata = result.metadata;
        await freshClaimed.save({ session });

        await TransactionEventService.record({
          session,
          transactionId: freshClaimed._id.toString(),
          previousStatus: "UNKNOWN",
          newStatus: "FAILED",
          reason: "payment_failed",
          actor: { type: "SYSTEM" },
          source: "payment:verify",
          traceId: `pay:${reference}`,
          metadata: {
            providerRef: result.providerRef,
            failureReason: freshClaimed.failureReason,
          },
        });

        for (const item of order.items) {
          await InventoryService.releaseReservation(
            item.product.toString(),
            item.quantity,
            session
          );
        }

        order.status = "FAILED";
        const failureNote = freshClaimed.failureReason || "Payment failed";
        order.statusHistory.push({
          status: "FAILED",
          timestamp: new Date(),
          note: failureNote,
        });
        await TrackingEvent.create(
          [{ orderId: order._id, status: "FAILED", description: failureNote }],
          { session }
        );
      }

      await order.save({ session });
      await session.commitTransaction();

      if (result.success) {
        OutboxProcessor.scheduleDrain();
      }

      return {
        order: order.toObject() as IOrder,
        transaction: freshClaimed.toObject() as ITransaction,
      };
    } catch (error) {
      await session.abortTransaction();
      await Transaction.updateOne(
        { _id: claimed._id, status: "UNKNOWN" },
        { $set: { status: "PROCESSING" } }
      );
      throw error;
    } finally {
      session.endSession();
    }
  }
  static async getTrackingEvents(orderId: string): Promise<ITrackingEvent[]> {
    const order = await Order.findById(orderId).lean();
    if (!order) {
      throw NotFoundError("Order");
    }

    return TrackingEvent.find({ orderId })
      .sort({ timestamp: -1 })
      .lean<ITrackingEvent[]>();
  }

  static async addTrackingEvent(
    orderId: string,
    status: OrderStatus,
    description: string,
    location?: string
  ): Promise<ITrackingEvent> {
    const order = await Order.findById(orderId);
    if (!order) {
      throw NotFoundError("Order");
    }

    const eventData: {
      orderId: string;
      status: OrderStatus;
      description: string;
      timestamp: Date;
      location?: string;
    } = {
      orderId,
      status,
      description,
      timestamp: new Date(),
    };
    if (location) eventData.location = location;

    const event = (await TrackingEvent.create(
      eventData
    )) as unknown as ITrackingEvent;

    if (order.status !== status) {
      assertValidTransition(order.status, status);
      order.status = status;
      order.statusHistory.push({
        status,
        timestamp: new Date(),
        note: description,
      });
      await order.save();
    }

    return event.toObject() as ITrackingEvent;
  }
}
