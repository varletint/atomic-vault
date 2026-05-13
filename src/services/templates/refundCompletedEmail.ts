import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderRefundCompletedEmail(
  data: OrderEmailData,
  refundAmount?: string
): { subject: string; html: string; text: string } {
  const subject = `Refund Processed for Order #${data.orderId}`;

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#e8f5e9; color:#2e7d32; padding:8px 20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        💸 Refund Processed
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      Your refund for order <strong>#${escapeHtml(
        data.orderId
      )}</strong> has been processed.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Original order placed on ${escapeHtml(data.orderDate)}
    </p>

    ${
      refundAmount
        ? `
    <div style="background:#e8f5e9; padding:16px; margin:0 0 20px; text-align:center;">
      <p style="margin:0 0 4px; font-size:13px; color:#666;">Refund Amount</p>
      <p style="margin:0; font-size:24px; font-weight:700; color:#2e7d32;">${escapeHtml(
        refundAmount
      )}</p>
    </div>`
        : ""
    }

    <p style="margin:0 0 16px; font-size:14px; color:#555;">
      The refund has been sent to your original payment method. Please allow 3–5 business days for the funds to appear in your account.
    </p>

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}

    <p style="margin:24px 0 0; font-size:13px; color:#888; text-align:center;">
      If you don't see the refund within 5 business days, please contact our support team.
    </p>
  `;

  const html = wrapLayout("Refund Processed", bodyHtml);

  const text = [
    `Refund Processed for Order #${data.orderId}`,
    `Original order placed on ${data.orderDate}`,
    refundAmount ? `Refund Amount: ${refundAmount}` : "",
    "",
    "The refund has been sent to your original payment method.",
    "Please allow 3-5 business days for the funds to appear.",
    "",
    renderItemsPlainText(data),
    "",
    "If you don't see the refund within 5 business days, please contact our support team.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
