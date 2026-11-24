import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromAddress =
  process.env.SMTP_FROM || smtpUser || "no-reply@gym-crm.local";

const smtpSecureDefault = smtpPort === 465;
const smtpSecure =
  process.env.SMTP_SECURE === "true"
    ? true
    : process.env.SMTP_SECURE === "false"
      ? false
      : smtpSecureDefault;

let transporter = null;
const forceConsole = process.env.EMAIL_LOG_OTPS === "true";

const emailSendTimeoutMs =
  Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 12_000;

if (!forceConsole && smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
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

if (
  transporter &&
  process.env.RENDER &&
  [25, 465, 587].includes(smtpPort)
) {
  console.warn(
    "[email] Render free web services block outbound SMTP ports 25/465/587. " +
      "If this service is on the free plan, use a provider that supports port 2525 " +
      "(Brevo, SendGrid, Mailgun) or upgrade the Render instance. Gmail SMTP will not work."
  );
}

function withTimeout(operation, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendMail(options) {
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

export async function sendOTPEmail(email, otp) {
  const subject = "Your Gym CRM verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes.`;
  const html = `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`;

  if (forceConsole) {
    console.log(`[email:dev] OTP for ${email}: ${otp}`);
    return true;
  }

  if (!transporter) {
    throw new Error("SMTP transport is not configured");
  }

  await sendMail({ to: email, subject, text, html });
  return true;
}

export async function sendPasswordResetOtpEmail(email, otp) {
  const subject = "Your Gym CRM password reset code";
  const text =
    `Your password reset code is ${otp}. It expires in 5 minutes.\n\n` +
    "If you didn't request this, you can ignore this email.";

  const html =
    `<p>Your password reset code is <strong>${otp}</strong>.</p>` +
    "<p>It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>";

  if (forceConsole) {
    console.log(`[email:dev] Password reset OTP for ${email}: ${otp}`);
    return true;
  }

  if (!transporter) {
    throw new Error("SMTP transport is not configured");
  }

  await sendMail({ to: email, subject, text, html });
  return true;
}

export async function sendPasswordResetEmail(email, resetUrl) {
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
