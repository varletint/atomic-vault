import nodemailer from "nodemailer";

const OTP_TTL_MINUTES = Math.max(
  5,
  parseInt(process.env.PASSWORD_RESET_OTP_TTL_MINUTES ?? "15", 10) || 15
);

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = parseInt(process.env.SMTP_PORT ?? "587", 10) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth:
      user && pass
        ? {
            user,
            pass,
          }
        : undefined,
  });
}

/**
 * Sends a password-reset OTP to the user's email.
 * If `SMTP_HOST` is unset, logs the OTP (development / local use).
 */
export async function sendPasswordResetOtpEmail(
  to: string,
  otp: string
): Promise<void> {
  const from = process.env.SMTP_FROM?.trim() ?? '"Order" <noreply@example.com>';
  const subject =
    process.env.PASSWORD_RESET_EMAIL_SUBJECT?.trim() ??
    "Your password reset code";
  const text = `Use this code to reset your password: ${otp}

It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`;

  const transport = createTransport();
  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SMTP_HOST is required in production for password reset emails"
      );
    }
    console.warn(
      `[EmailService] SMTP_HOST not set; password reset OTP for ${to}: ${otp}`
    );
    return;
  }

  await transport.sendMail({ from, to, subject, text });
}

/**
 * Sends an email-verification link to the user.
 * If `SMTP_HOST` is unset, logs the URL (development / local use).
 */
export async function sendVerificationEmail(
  to: string,
  verifyUrl: string
): Promise<void> {
  const from = process.env.SMTP_FROM?.trim() ?? '"Order" <noreply@example.com>';
  const subject = "Verify your email address";
  const text = `Click the link below to verify your email address:\n\n${verifyUrl}\n\nThis link will expire in 24 hours. If you did not create an account, you can ignore this email.`;

  const transport = createTransport();
  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SMTP_HOST is required in production for verification emails"
      );
    }
    console.warn(
      `[EmailService] SMTP_HOST not set; verification URL for ${to}: ${verifyUrl}`
    );
    return;
  }

  await transport.sendMail({ from, to, subject, text });
}
