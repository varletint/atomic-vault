import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderOrderFailedEmail(
  data: OrderEmailData,
  reason?: string
): { subject: string; html: string; text: string } {
  const subject = `Order #${data.orderId} Could Not Be Processed`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#ffebee; color:#b71c1c; padding:8px 20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        ❌ Order Failed
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      We're sorry — your order <strong>#${escapeHtml(
        data.orderId
      )}</strong> could not be processed due to a system error.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Placed on ${escapeHtml(data.orderDate)}
    </p>
    ${
      reason
        ? `<p style="margin:0 0 20px; font-size:14px; color:#555; background:#f9f9f9; padding:12px; border-left:4px solid #b71c1c;"><strong>Details:</strong> ${escapeHtml(
            reason
          )}</p>`
        : ""
    }

    <p style="margin:0 0 16px; font-size:14px; color:#555;">
      No payment was charged and all reserved items have been released back to stock.
      Please try placing your order again.
    </p>

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}

    <p style="margin:24px 0 0; font-size:13px; color:#888; text-align:center;">
      If this issue persists, please contact our support team with your order reference.
    </p>
  `;

  const html = wrapLayout("Order Failed", bodyHtml);

  const text = [
    `Order #${data.orderId} Could Not Be Processed`,
    `Placed on ${data.orderDate}`,
    reason ? `Details: ${reason}` : "",
    "",
    "No payment was charged and all reserved items have been released.",
    "Please try placing your order again.",
    "",
    renderItemsPlainText(data),
    "",
    "If this issue persists, please contact our support team.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
