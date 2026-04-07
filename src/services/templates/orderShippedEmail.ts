import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderAddressHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderOrderShippedEmail(
  data: OrderEmailData,
  note?: string
): { subject: string; html: string; text: string } {
  const subject = `Order #${data.orderId} Shipped — On Its Way!`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#e3f2fd; color:#1565c0; padding:8px 20px; border-radius:20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        📦 Order Shipped
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      Great news! Your order <strong>#${escapeHtml(
        data.orderId
      )}</strong> has been shipped and is on its way to you.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Placed on ${escapeHtml(data.orderDate)}
    </p>
    ${
      note
        ? `<p style="margin:0 0 20px; font-size:14px; color:#555; background:#f9f9f9; padding:12px; border-left:4px solid #1565c0;"><strong>Carrier Note:</strong> ${escapeHtml(
            note
          )}</p>`
        : ""
    }

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}
    ${renderAddressHtml("Shipping Address", data.shippingAddress)}

    <p style="margin:24px 0 0; font-size:13px; color:#888; text-align:center;">
      You'll receive another email when your order has been delivered.
    </p>
  `;

  const html = wrapLayout("Order Shipped", bodyHtml);

  const text = [
    `Order #${data.orderId} Shipped`,
    `Placed on ${data.orderDate}`,
    note ? `Carrier Note: ${note}` : "",
    "",
    renderItemsPlainText(data),
    "",
    `Shipping Address: ${data.shippingAddress}`,
    "",
    "You'll receive another email when your order has been delivered.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
