import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderAddressHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderOrderCancelledEmail(
  data: OrderEmailData,
  reason?: string
): { subject: string; html: string; text: string } {
  const subject = `Order #${data.orderId} Cancelled`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#ffebee; color:#c62828; padding:8px 20px; border-radius:20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        ❌ Order Cancelled
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      Your order <strong>#${escapeHtml(
        data.orderId
      )}</strong> has been cancelled.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Placed on ${escapeHtml(data.orderDate)}
    </p>
    ${
      reason
        ? `<p style="margin:0 0 20px; font-size:14px; color:#555; background:#f9f9f9; padding:12px; border-left:4px solid #c62828;"><strong>Reason:</strong> ${escapeHtml(
            reason
          )}</p>`
        : ""
    }

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}
    ${renderAddressHtml("Shipping Address", data.shippingAddress)}

    <p style="margin:24px 0 0; font-size:13px; color:#888; text-align:center;">
      If you have any questions, please contact our support team.
    </p>
  `;

  const html = wrapLayout("Order Cancelled", bodyHtml);

  const text = [
    `Order #${data.orderId} Cancelled`,
    `Placed on ${data.orderDate}`,
    reason ? `Reason: ${reason}` : "",
    "",
    renderItemsPlainText(data),
    "",
    `Shipping Address: ${data.shippingAddress}`,
    "",
    "If you have any questions, please contact our support team.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
