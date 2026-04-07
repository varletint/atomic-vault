import mongoose from "mongoose";
import {
  OrderDocument,
  Order,
  Transaction,
  type IOrder,
} from "../models/index.js";
import { NotFoundError } from "../utils/AppError.js";
import { PdfService } from "./PdfService.js";
import { StorageService } from "./StorageService.js";

/**
 * Handles post-payment invoice generation for confirmed orders.
 * Email sending is handled by OrderNotificationService.
 */
export class OrderCompletionService {
  static async handleOrderCompleted(payload: {
    orderId: string;
    paymentReference?: string;
  }): Promise<{ invoiceUrl: string }> {
    const order = await Order.findById(payload.orderId).lean<IOrder | null>();
    if (!order) throw NotFoundError("Order");

    const currencyContext = await this.resolveCurrencyContext(
      order._id.toString(),
      payload.paymentReference
    );

    const invoiceDoc = await this.ensureInvoicePdf(order, currencyContext);
    const invoiceUrl = await StorageService.getPrivateReadUrl(
      invoiceDoc.storageKey,
      60 * 60 * 24 * 7
    );

    return { invoiceUrl };
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

  private static async resolveCurrencyContext(
    orderId: string,
    paymentReference?: string
  ): Promise<{ currency?: string; locale?: string }> {
    if (!paymentReference) return {};

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

    const ctx: { currency?: string; locale?: string } = {};
    if (currency) ctx.currency = currency;
    if (locale) ctx.locale = locale;
    return ctx;
  }
}
