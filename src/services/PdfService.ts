import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import type { IOrder } from "../models/index.js";
import { formatMinorCurrency } from "../utils/currency.js";

export type GeneratedPdf = {
  buffer: Buffer;
  sha256: string;
  sizeBytes: number;
};

export class PdfService {
  static async generateInvoicePdf(
    order: IOrder,
    options?: { currency?: string; locale?: string }
  ): Promise<GeneratedPdf> {
    const currency = options?.currency;
    const locale = options?.locale;

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    doc.fontSize(18).text("Invoice", { align: "left" });
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .fillColor("#333333")
      .text(`Order ID: ${order._id.toString()}`)
      .text(`Status: ${order.status}`)
      .text(`Created: ${new Date(order.createdAt).toISOString()}`);

    doc.moveDown(1);
    doc.fontSize(12).text("Items", { underline: true });
    doc.moveDown(0.5);

    let y = doc.y;
    doc.fontSize(10).text("Product", 50, y);
    doc.text("Qty", 320, y);
    doc.text("Unit", 360, y);
    doc.text("Subtotal", 430, y);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.5);

    for (const item of order.items) {
      y = doc.y;
      doc.fillColor("#111111").text(item.productName, 50, y, { width: 250 });
      doc.text(String(item.quantity), 320, y);
      doc.text(formatMoney(item.pricePerUnit, currency, locale), 360, y);
      doc.text(formatMoney(item.subtotal, currency, locale), 430, y);
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.75);

    const itemsTotal = order.totalAmount;
    const deliveryFee = order.deliveryFee ?? 0;
    const total = itemsTotal + deliveryFee;

    doc.fillColor("#333333").fontSize(10);
    doc.text(`Items: ${formatMoney(itemsTotal, currency, locale)}`, 350);
    doc.text(`Delivery: ${formatMoney(deliveryFee, currency, locale)}`, 350);
    doc
      .fontSize(12)
      .fillColor("#111111")
      .text(`Total: ${formatMoney(total, currency, locale)}`, 350);

    doc.moveDown(1.5);
    doc.fontSize(10).fillColor("#333333").text("Shipping address", {
      underline: true,
    });
    doc
      .moveDown(0.5)
      .fillColor("#111111")
      .text(order.shippingAddress.street)
      .text(
        `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zip}`
      )
      .text(order.shippingAddress.country);

    doc.end();

    const buffer = await done;
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    return { buffer, sha256, sizeBytes: buffer.length };
  }
}

function formatMoney(
  kobo: number,
  currency?: string,
  locale?: string
): string {
  const opts: { currency?: string; locale?: string } = {};
  if (currency) opts.currency = currency;
  if (locale) opts.locale = locale;
  return formatMinorCurrency(kobo, opts);
}

