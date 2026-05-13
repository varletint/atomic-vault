import {
  type OrderEmailData,
  wrapLayout,
  renderItemsTableHtml,
  renderTotalsHtml,
  renderAddressHtml,
  renderItemsPlainText,
  escapeHtml,
} from "./emailLayout.js";

export function renderOrderPaymentFailedEmail(
  data: OrderEmailData,
  failureReason?: string,
  retryUrl?: string
): { subject: string; html: string; text: string } {
  const subject = `Payment Failed for Order #${data.orderId}`;

  const retryCta = retryUrl
    ? `
    <div style="text-align:center; margin:24px 0;">
      <a href="${escapeHtml(retryUrl)}"
         style="display:inline-block; background:#1a1a2e; color:#ffffff; padding:12px 32px; font-weight:700; font-size:14px; text-decoration:none; letter-spacing:0.5px;">
        Retry Payment
      </a>
    </div>`
    : "";

  const bodyHtml = `
    <div style="text-align:center; margin-bottom:24px;">
      <span style="display:inline-block; background:#fff3e0; color:#e65100; padding:8px 20px; font-weight:700; font-size:14px; letter-spacing:0.5px;">
        ⚠️ Payment Failed
      </span>
    </div>

    <p style="margin:0 0 8px; font-size:15px; color:#333;">
      We were unable to process the payment for your order <strong>#${escapeHtml(
        data.orderId
      )}</strong>.
    </p>
    <p style="margin:0 0 20px; font-size:13px; color:#888;">
      Placed on ${escapeHtml(data.orderDate)}
    </p>
    ${
      failureReason
        ? `<p style="margin:0 0 20px; font-size:14px; color:#555; background:#f9f9f9; padding:12px; border-left:4px solid #e65100;"><strong>Reason:</strong> ${escapeHtml(
            failureReason
          )}</p>`
        : ""
    }

    <p style="margin:0 0 16px; font-size:14px; color:#555;">
      Your items are still reserved. You can retry the payment at any time before the reservation expires.
    </p>

    ${retryCta}

    ${renderItemsTableHtml(data)}
    ${renderTotalsHtml(data)}
    ${renderAddressHtml("Shipping Address", data.shippingAddress)}

    <p style="margin:24px 0 0; font-size:13px; color:#888; text-align:center;">
      If you continue to experience issues, please contact our support team.
    </p>
  `;

  const html = wrapLayout("Payment Failed", bodyHtml);

  const text = [
    `Payment Failed for Order #${data.orderId}`,
    `Placed on ${data.orderDate}`,
    failureReason ? `Reason: ${failureReason}` : "",
    "",
    "Your items are still reserved. You can retry the payment at any time.",
    retryUrl ? `Retry payment: ${retryUrl}` : "",
    "",
    renderItemsPlainText(data),
    "",
    `Shipping Address: ${data.shippingAddress}`,
    "",
    "If you continue to experience issues, please contact our support team.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
