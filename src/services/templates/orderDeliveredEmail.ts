import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderAddressHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderOrderDeliveredEmail(data: OrderEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Order #${data.orderId} Delivered — Enjoy Your Purchase!`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#e3f2fd; color:#1565c0; padding:8px 20px; border-radius:20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        📦 Order Delivered
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      Great news! Your order <strong>#${escapeHtml(
        data.orderId
      )}</strong> has been delivered.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Originally placed on ${escapeHtml(data.orderDate)}
    </p>

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}
    ${renderAddressHtml("Delivered To", data.shippingAddress)}

    <p style="margin:16px 0 0; font-size:13px; color:#888; text-align:center;">
      If you didn't receive your package or have any issues, please contact our support team.
    </p>
  `;

  const html = wrapLayout("Order Delivered", bodyHtml);

  const text = [
    `Order #${data.orderId} Delivered`,
    `Originally placed on ${data.orderDate}`,
    "",
    renderItemsPlainText(data),
    "",
    `Delivered To: ${data.shippingAddress}`,
    "",
    "If you didn't receive your package or have any issues, please contact our support team.",
  ].join("\n");

  return { subject, html, text };
}
