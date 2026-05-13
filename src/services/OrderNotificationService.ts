import {
  NotificationLog,
  Order,
  User,
  type IOrder,
  type NotificationType,
} from "../models/index.js";
import { NotFoundError } from "../utils/AppError.js";
import { EmailService } from "./EmailService.js";
import { OrderCompletionService } from "./OrderCompletionService.js";
import { buildOrderEmailData } from "./templates/emailLayout.js";
import { renderOrderCompletedEmail } from "./templates/orderCompletedEmail.js";
import { renderOrderDeliveredEmail } from "./templates/orderDeliveredEmail.js";
import { renderOrderShippedEmail } from "./templates/orderShippedEmail.js";
import { renderOrderCancelledEmail } from "./templates/orderCancelledEmail.js";
import { renderOrderPaymentFailedEmail } from "./templates/orderPaymentFailedEmail.js";
import { renderOrderFailedEmail } from "./templates/orderFailedEmail.js";
import { renderRefundCompletedEmail } from "./templates/refundCompletedEmail.js";
import { formatMinorCurrency } from "../utils/currency.js";

export class OrderNotificationService {
  static async handleOrderConfirmed(payload: {
    orderId: string;
    paymentReference?: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);

    const { invoiceUrl } = await OrderCompletionService.handleOrderCompleted({
      orderId: payload.orderId,
      paymentReference: payload.paymentReference,
    });

    const emailData = buildOrderEmailData(order);
    const email = renderOrderCompletedEmail({ ...emailData, invoiceUrl });

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_CONFIRMED",
      to: customerEmail,
      email,
    });
  }

  static async handleOrderDelivered(payload: {
    orderId: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);
    const email = renderOrderDeliveredEmail(emailData);

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_DELIVERED",
      to: customerEmail,
      email,
    });
  }

  static async handleOrderShipped(payload: {
    orderId: string;
    note?: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);
    const email = renderOrderShippedEmail(emailData, payload.note);

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_SHIPPED" as any,
      to: customerEmail,
      email,
    });
  }

  static async handleOrderCancelled(payload: {
    orderId: string;
    reason?: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);
    const email = renderOrderCancelledEmail(emailData, payload.reason);

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_CANCELLED" as any,
      to: customerEmail,
      email,
    });
  }

  static async handleOrderPaymentFailed(payload: {
    orderId: string;
    paymentReference: string;
    failureReason: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const retryUrl = `${frontendUrl}/orders/${order._id.toString()}/payment`;

    const email = renderOrderPaymentFailedEmail(
      emailData,
      payload.failureReason,
      retryUrl
    );

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_PAYMENT_FAILED",
      to: customerEmail,
      email,
    });
  }

  static async handleOrderFailed(payload: {
    orderId: string;
    reason: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);
    const email = renderOrderFailedEmail(emailData, payload.reason);

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "ORDER_FAILED",
      to: customerEmail,
      email,
    });
  }

  static async handleRefundCompleted(payload: {
    orderId: string;
    refundAmount?: number;
    currency?: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const customerEmail = await this.resolveCustomerEmail(order);
    const emailData = buildOrderEmailData(order);

    const refundAmountStr = payload.refundAmount
      ? formatMinorCurrency(payload.refundAmount)
      : undefined;

    const email = renderRefundCompletedEmail(emailData, refundAmountStr);

    await this.sendAndLog({
      orderId: order._id.toString(),
      type: "REFUND_COMPLETED",
      to: customerEmail,
      email,
    });
  }

  private static async sendAndLog(params: {
    orderId: string;
    type: NotificationType;
    to: string;
    email: { subject: string; html: string; text: string };
  }): Promise<void> {
    const alreadySent = await NotificationLog.findOne({
      orderId: params.orderId,
      type: params.type,
      channel: "EMAIL",
      status: "SENT",
    }).lean();
    if (alreadySent) return;

    const attempt = await NotificationLog.countDocuments({
      orderId: params.orderId,
      type: params.type,
      channel: "EMAIL",
    }).then((n) => n + 1);

    try {
      const sent = await EmailService.sendEmail({
        to: params.to,
        subject: params.email.subject,
        html: params.email.html,
        text: params.email.text,
      });

      await NotificationLog.create({
        orderId: params.orderId,
        type: params.type,
        channel: "EMAIL",
        to: params.to,
        status: "SENT",
        provider: sent.provider,
        providerMessageId: sent.messageId,
        attempt,
      });
    } catch (err) {
      await NotificationLog.create({
        orderId: params.orderId,
        type: params.type,
        channel: "EMAIL",
        to: params.to,
        status: "FAILED",
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private static async resolveCustomerEmail(order: IOrder): Promise<string> {
    if (order.guestContact?.email) return order.guestContact.email;

    if (order.user) {
      const user = await User.findById(order.user)
        .select("email")
        .lean<{ email?: string } | null>();
      if (user?.email) return user.email;
    }

    throw new Error("Cannot resolve customer email for order notification.");
  }
}
