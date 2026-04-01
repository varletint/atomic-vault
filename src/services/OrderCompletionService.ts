import mongoose from "mongoose";
import {
  NotificationLog,
  Order,
  OrderDocument,
  Transaction,
  User,
  type IOrder,
} from "../models/index.js";
import { NotFoundError } from "../utils/AppError.js";
import { PdfService } from "./PdfService.js";
import { StorageService } from "./StorageService.js";
import { EmailService } from "./EmailService.js";
import { renderOrderCompletedEmail } from "./templates/orderCompletedEmail.js";

export class OrderCompletionService {
  static async handleOrderCompleted(payload: {
    orderId: string;
    paymentReference: string;
  }): Promise<void> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");
    const currencyContext = await this.resolveCurrencyContext(
      order._id.toString(),
      payload.paymentReference
    );

    const customerEmail = await this.resolveCustomerEmail(order);

    const invoiceDoc = await this.ensureInvoicePdf(order, currencyContext);
    const invoiceUrl = await StorageService.getPrivateReadUrl(
      invoiceDoc.storageKey,
      60 * 60 * 24 * 7
    );

    const email = renderOrderCompletedEmail({
      orderId: order._id.toString(),
      orderStatus: order.status,
      invoiceUrl,
    });

    const attempt = await NotificationLog.countDocuments({
      orderId: order._id,
      type: "ORDER_COMPLETED",
      channel: "EMAIL",
    }).then((n) => n + 1);

    try {
      const sent = await EmailService.sendEmail({
        to: customerEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      await NotificationLog.create({
        orderId: order._id,
        type: "ORDER_COMPLETED",
        channel: "EMAIL",
        to: customerEmail,
        status: "SENT",
        provider: sent.provider,
        providerMessageId: sent.messageId,
        attempt,
      });
    } catch (err) {
      await NotificationLog.create({
        orderId: order._id,
        type: "ORDER_COMPLETED",
        channel: "EMAIL",
        to: customerEmail,
        status: "FAILED",
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private static async ensureInvoicePdf(
    order: IOrder,
    currencyContext?: { currency?: string; locale?: string }
  ) {
    const existing = await OrderDocument.findOne({
      orderId: order._id,
      type: "INVOICE_PDF",
    }).lean();
    if (existing) return existing;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const locked = await OrderDocument.findOne({
        orderId: order._id,
        type: "INVOICE_PDF",
      }).session(session);
      if (locked) {
        await session.commitTransaction();
        return locked.toObject();
      }

      const pdf = await PdfService.generateInvoicePdf(order, currencyContext);
      const key = `invoices/${order._id.toString()}/invoice.pdf`;

      await StorageService.putPrivateObject({
        key,
        body: pdf.buffer,
        contentType: "application/pdf",
      });

      const created = await OrderDocument.create(
        [
          {
            orderId: order._id,
            type: "INVOICE_PDF",
            storageKey: key,
            contentType: "application/pdf",
            sizeBytes: pdf.sizeBytes,
            sha256: pdf.sha256,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return created[0]!.toObject();
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
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

    throw new Error("Cannot resolve customer email for completed order.");
  }

  private static async resolveCurrencyContext(
    orderId: string,
    paymentReference: string
  ): Promise<{ currency?: string; locale?: string }> {
    const tx = await Transaction.findOne({
      order: orderId,
      idempotencyKey: paymentReference,
    })
      .sort({ createdAt: -1 })
      .lean();

    const metadata = tx?.metadata as Record<string, unknown> | undefined;
    const locale =
      typeof metadata?.locale === "string" ? metadata.locale : undefined;
    const currency = tx?.currency;

    return { currency, locale };
  }
}

