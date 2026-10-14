import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromAddress =
  process.env.SMTP_FROM || smtpUser || "no-reply@gym-crm.local";

let transporter: nodemailer.Transporter | null = null;

if (smtpHost && smtpUser && smtpPass) {
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

export async function sendOTPEmail(email: string, otp: string): Promise<void> {
  const subject = "Your Gym CRM verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes.`;
  const html = `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`;

  if (!transporter) {
    console.log(`[email:dev] OTP for ${email}: ${otp}`);
    return;
  }

  await transporter.sendMail({ from: fromAddress, to: email, subject, text, html });
}
