import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromAddress =
  process.env.SMTP_FROM || smtpUser || "no-reply@gym-crm.local";

let transporter: Transporter | null = null;

// Explicit dev/testing switch: EMAIL_LOG_OTPS=true logs OTPs (and reset
// links) to the server console instead of emailing them — handy on local
// environments where you don't control the SMTP inbox.
const forceConsole = process.env.EMAIL_LOG_OTPS === "true";

if (!forceConsole && smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
} else {
  console.warn(
    "[email] SMTP_HOST/SMTP_USER/SMTP_PASS not set — OTPs will be logged to the console instead of emailed. " +
      "Set SMTP_* env vars to send real emails."
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendOTPEmail(email: string, otp: string): Promise<void> {
  const subject = "Your Gym CRM verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes.`;
  const html = `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`;

  if (!transporter || forceConsole) {
    console.log(`[email:dev] OTP for ${email}: ${otp}`);
    return;
  }

  await transporter.sendMail({ from: fromAddress, to: email, subject, text, html });
}

/**
 * Send a password-reset link. The link points at the frontend reset page,
 * which exchanges the token for a new password via POST /api/v1/auth/reset-password.
 * In dev (SMTP unset) the link is logged instead of emailed.
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
): Promise<void> {
  const subject = "Reset your Gym CRM password";
  const text =
    `Reset your password: ${resetUrl}\n\n` +
    "This link expires in 1 hour. If you didn't request this, you can ignore this email.";
  const html =
    `<p>Reset your password:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>` +
    "<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>";

  if (!transporter || forceConsole) {
    console.log(`[email:dev] Password reset link for ${email}: ${resetUrl}`);
    return;
  }

  await transporter.sendMail({ from: fromAddress, to: email, subject, text, html });
}
