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

/**
 * Hard cap for a single email delivery. Signup awaits the verification email,
 * so a slow or unreachable SMTP server must never keep the HTTP request open
 * until the browser gives up (the client timeout is 30s by default).
 */
const emailSendTimeoutMs =
  Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 12_000;

if (!forceConsole && smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
    // Nodemailer's defaults are measured in minutes. Fail fast instead so a
    // blocked SMTP port (Render free blocks 25/465/587) cannot stall signup.
    connectionTimeout:
      Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 8_000,
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 8_000,
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 15_000,
    dnsTimeout: Number(process.env.SMTP_DNS_TIMEOUT_MS) || 5_000,
  });
} else if (forceConsole) {
  console.warn(
    "[email] EMAIL_LOG_OTPS=true — OTPs and password reset links will be logged to the console."
  );
} else {
  console.warn(
    "[email] SMTP_HOST/SMTP_USER/SMTP_PASS not set — OTP emails cannot be delivered. " +
      "Set SMTP_* env vars, or set EMAIL_LOG_OTPS=true to log OTPs to the console in development."
  );
}

// Render blocks outbound traffic on the standard SMTP ports for free web
// services. Gmail only listens on 465/587, so it cannot deliver mail from a
// free Render instance; port 2525 with a provider that supports it does work.
if (transporter && process.env.RENDER && [25, 465, 587].includes(smtpPort)) {
  console.warn(
    "[email] Render free web services block outbound SMTP ports 25/465/587. " +
      "If this service is on the free plan, use a provider that supports port 2525 " +
      "(Brevo, SendGrid, Mailgun) or upgrade the Render instance. Gmail SMTP will not work."
  );
}

/**
 * Races an async operation against a deadline. The underlying operation is not
 * cancelled (Nodemailer owns the socket), but the caller is released as soon
 * as the deadline passes so an HTTP request cannot hang indefinitely.
 */
function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!transporter) {
    throw new Error("SMTP transport is not configured");
  }

  try {
    await withTimeout(
      transporter.sendMail({ from: fromAddress, ...options }),
      emailSendTimeoutMs,
      "Email send"
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[email] Could not send "${options.subject}" to ${options.to}: ${reason}`
    );
    throw err;
  }
}

export async function sendOTPEmail(
  email: string,
  otp: string
): Promise<boolean> {
  const subject = "Your Gym CRM verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes.`;
  const html = `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`;

  if (forceConsole) {
    console.log(`[email:dev] OTP for ${email}: ${otp}`);
    return true;
  }

  // No transport means the OTP was not emailed. Throw so the caller can
  // report `emailSent: false` instead of falsely claiming delivery.
  if (!transporter) {
    throw new Error("SMTP transport is not configured");
  }

  await sendMail({ to: email, subject, text, html });
  return true;
}

/**
 * Send a password-reset link. The link points at the frontend reset page,
 * which exchanges the token for a new password via POST /api/v1/auth/reset-password.
 * In dev (SMTP unset) the link is logged instead of emailed.
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
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

  await sendMail({ to: email, subject, text, html });
}
