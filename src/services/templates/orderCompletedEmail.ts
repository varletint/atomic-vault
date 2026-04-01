export function renderOrderCompletedEmail(params: {
  orderId: string;
  orderStatus: string;
  invoiceUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = "Your order is confirmed";
  const text = `Your order (${params.orderId}) is ${params.orderStatus}.\n\nDownload your invoice: ${params.invoiceUrl}\n`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Order confirmed</h2>
      <p style="margin: 0 0 12px;">
        Your order <strong>${escapeHtml(params.orderId)}</strong> is <strong>${escapeHtml(
          params.orderStatus
        )}</strong>.
      </p>
      <p style="margin: 0 0 12px;">
        Invoice: <a href="${escapeAttr(params.invoiceUrl)}">Download PDF</a>
      </p>
      <p style="margin: 24px 0 0; color: #666; font-size: 12px;">
        If you did not place this order, please contact support.
      </p>
    </div>
  `.trim();

  return { subject, html, text };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(input: string): string {
  // good enough for URLs in email templates
  return escapeHtml(input);
}

