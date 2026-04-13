import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderAddressHtml,
  renderItemsPlainText,
  escapeHtml,
  escapeAttr,
} from "./emailLayout.js";

export function renderOrderCompletedEmail(
  data: OrderEmailData & { invoiceUrl: string }
): { subject: string; html: string; text: string } {
  const subject = `Order #${data.orderId} Confirmed — We're Preparing Your Order`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#e8f5e9; color:#2e7d32; padding:8px 20px;  font-weight:700; font-size:14px; letter-spacing:0.5px;">
        ✅ Order Confirmed
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      Thank you for your purchase! Your order <strong>#${escapeHtml(
        data.orderId
      )}</strong> has been confirmed.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Placed on ${escapeHtml(data.orderDate)}
    </p>

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}
    ${renderAddressHtml("Shipping Address", data.shippingAddress)}

    <div style="text-align:center; margin:24px 0;">
      <a href="${escapeAttr(data.invoiceUrl)}"
         style="display:inline-block; background:#1a1a2e; color:#ffffff; padding:12px 28px; text-decoration:none; font-weight:600; font-size:14px;">
        Download Invoice (PDF)
      </a>
    </div>

    <p style="margin:16px 0 0; font-size:13px; color:#888; text-align:center;">
      You'll receive another email when your order is shipped and delivered.
    </p>
  `;

  const html = wrapLayout("Order Confirmed", bodyHtml);

  const text = [
    `Order #${data.orderId} Confirmed`,
    `Placed on ${data.orderDate}`,
    "",
    renderItemsPlainText(data),
    "",
    `Shipping Address: ${data.shippingAddress}`,
    "",
    `Download Invoice: ${data.invoiceUrl}`,
    "",
    "You'll receive another email when your order is shipped and delivered.",
  ].join("\n");

  return { subject, html, text };
}
