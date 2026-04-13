import type { IOrder, IOrderItem } from "../../models/index.js";
import { formatMinorCurrency } from "../../utils/currency.js";

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(input: string): string {
  return escapeHtml(input);
}

export interface OrderEmailItemRow {
  productName: string;
  variantLabel?: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
}

export interface OrderEmailData {
  orderId: string;
  orderDate: string;
  items: OrderEmailItemRow[];
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  shippingAddress: string;
}

export function buildOrderEmailData(order: IOrder): OrderEmailData {
  const fmt = (kobo: number) => formatMinorCurrency(kobo);

  const items: OrderEmailItemRow[] = order.items.map((item: IOrderItem) => ({
    productName: item.productName,
    variantLabel: item.variantLabel,
    quantity: item.quantity,
    unitPrice: fmt(item.pricePerUnit),
    subtotal: fmt(item.subtotal),
  }));

  const deliveryFee = order.deliveryFee ?? 0;
  const grandTotal = order.totalAmount + deliveryFee;

  const addr = order.shippingAddress;
  const shippingAddress = [
    addr.street,
    addr.city,
    addr.state,
    addr.zip,
    addr.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    orderId: order._id.toString(),
    orderDate: new Date(order.createdAt).toLocaleDateString("en-NG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    items,
    itemsTotal: fmt(order.totalAmount),
    deliveryFee: fmt(deliveryFee),
    grandTotal: fmt(grandTotal),
    shippingAddress,
  };
}

export function wrapLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f7; font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px; width:100%; background:#ffffff;  overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e; padding:24px 32px;">
              <h1 style="margin:0; color:#ffffff; font-size:20px; font-weight:700; letter-spacing:0.5px;">
                ${escapeHtml(title)}
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9fb; padding:20px 32px; border-top:1px solid #eee;">
              <p style="margin:0; color:#999; font-size:12px; line-height:1.5;">
                If you have any questions, reply to this email or contact our support team.
              </p>
              <p style="margin:8px 0 0; color:#bbb; font-size:11px;">
                &copy; ${new Date().getFullYear()} Your Store. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderItemsTableHtml(data: OrderEmailData): string {
  const rows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0;">
          ${escapeHtml(item.productName)}${
        item.variantLabel
          ? `<br/><span style="color:#888; font-size:12px;">${escapeHtml(
              item.variantLabel
            )}</span>`
          : ""
      }
        </td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:center;">${
          item.quantity
        }</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:right;">${escapeHtml(
          formatMinorCurrency(Number(item.unitPrice))
        )}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:right;">${escapeHtml(
          formatMinorCurrency(Number(item.subtotal))
        )}</td>
      </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;  overflow:hidden; margin:16px 0;">
      <thead>
        <tr style="background:#f9f9fb;">
          <th style="padding:10px 12px; text-align:left; font-size:13px; color:#666; font-weight:600;">Item</th>
          <th style="padding:10px 12px; text-align:center; font-size:13px; color:#666; font-weight:600;">Qty</th>
          <th style="padding:10px 12px; text-align:right; font-size:13px; color:#666; font-weight:600;">Price</th>
          <th style="padding:10px 12px; text-align:right; font-size:13px; color:#666; font-weight:600;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
}

export function renderTotalsHtml(data: OrderEmailData): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td style="padding:4px 0; color:#666; font-size:14px;">Items Total</td>
        <td style="padding:4px 0; text-align:right; font-size:14px;">${escapeHtml(
          formatMinorCurrency(Number(data.itemsTotal))
        )}</td>
      </tr>
      <tr>
        <td style="padding:4px 0; color:#666; font-size:14px;">Delivery Fee</td>
        <td style="padding:4px 0; text-align:right; font-size:14px;">${escapeHtml(
          formatMinorCurrency(Number(data.deliveryFee))
        )}</td>
      </tr>
      <tr>
        <td style="padding:8px 0 0; font-weight:700; font-size:16px; border-top:2px solid #1a1a2e;">Grand Total</td>
        <td style="padding:8px 0 0; text-align:right; font-weight:700; font-size:16px; border-top:2px solid #1a1a2e;">${escapeHtml(
          formatMinorCurrency(Number(data.grandTotal))
        )}</td>
      </tr>
    </table>`;
}

export function renderAddressHtml(label: string, address: string): string {
  return `
    <div style="background:#f9f9fb;  padding:12px 16px; margin:16px 0;">
      <p style="margin:0 0 4px; font-size:12px; color:#888; text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(
        label
      )}</p>
      <p style="margin:0; font-size:14px; color:#333;">${escapeHtml(
        address
      )}</p>
    </div>`;
}

export function renderItemsPlainText(data: OrderEmailData): string {
  const lines = data.items.map(
    (item) =>
      `  - ${item.productName}${
        item.variantLabel ? ` (${item.variantLabel})` : ""
      } x${item.quantity} @ ${formatMinorCurrency(
        Number(item.unitPrice)
      )} = ${formatMinorCurrency(Number(item.subtotal))}`
  );
  return [
    "Order Items:",
    ...lines,
    "",
    `Items Total: ${formatMinorCurrency(Number(data.itemsTotal))}`,
    `Delivery Fee: ${formatMinorCurrency(Number(data.deliveryFee))}`,
    `Grand Total: ${formatMinorCurrency(Number(data.grandTotal))}`,
  ].join("\n");
}
