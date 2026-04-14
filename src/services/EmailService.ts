import nodemailer from "nodemailer";
import { logger } from "../utils/logger.js";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export class EmailService {
  static async sendEmail(params: SendEmailParams): Promise<{
    provider: string;
    messageId: string;
  }> {
    const result = createTransport();
    if (!result) {
      throw new Error("Email transport is not configured.");
    }

    const info = await result.transport.sendMail({
      from: result.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    return { provider: "smtp", messageId: info.messageId ?? "" };
  }
}

const OTP_TTL_MINUTES = Math.max(
  5,
  parseInt(process.env.PASSWORD_RESET_OTP_TTL_MINUTES ?? "15", 10) || 15
);

interface TransportResult {
  transport: ReturnType<typeof nodemailer.createTransport>;
  from: string;
}

function createTransport(): TransportResult | null {
  // Primary: use EMAIL_USER / EMAIL_PASS (Gmail App Password)
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.trim();

  if (emailUser && emailPass) {
    return {
      transport: nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      }),
      // Gmail requires from to match the authenticated account
      from: emailUser,
    };
  }

  // Fallback: generic SMTP config
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = parseInt(process.env.SMTP_PORT ?? "587", 10) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  return {
    transport: nodemailer.createTransport({
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
    }),
    from: process.env.SMTP_FROM?.trim() ?? '"Order" <noreply@example.com>',
  };
}

/**
 * Sends a password-reset OTP to the user's email.
 * If `SMTP_HOST` is unset, logs the OTP (development / local use).
 */
export async function sendPasswordResetOtpEmail(
  to: string,
  otp: string
): Promise<void> {
  const subject =
    process.env.PASSWORD_RESET_EMAIL_SUBJECT?.trim() ??
    "Your password reset code";
  const text = `Use this code to reset your password: ${otp}

It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`;

  const result = createTransport();
  if (!result) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Email transport is required in production for password reset emails"
      );
    }
    logger.warn("No email transport configured; password reset OTP generated", {
      to,
    });
    return;
  }

  await result.transport.sendMail({ from: result.from, to, subject, text });
}

/**
 * Sends an email-verification link to the user.
 * If `SMTP_HOST` is unset, logs the URL (development / local use).
 */
export async function sendVerificationEmail(
  to: string,
  verifyUrl: string
): Promise<void> {
  const subject = "Verify your email address";
  const text = `Click the link below to verify your email address:\n\n${verifyUrl}\n\nThis link will expire in 24 hours. If you did not create an account, you can ignore this email.`;

  const result = createTransport();
  if (!result) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Email transport is required in production for verification emails"
      );
    }
    logger.warn("No email transport configured; verification URL generated", {
      to,
    });
    return;
  }

  await result.transport.sendMail({ from: result.from, to, subject, text });
}
