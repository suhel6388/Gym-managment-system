/**
 * Premium black-and-gold receipt PDF.
 *
 * The design is drawn programmatically with PDFKit (no headless browser) so a
 * receipt adds only a few milliseconds after the payment transaction commits.
 * It mirrors the on-screen <ReceiptPreview>: black masthead, gold rules,
 * cream "paper" panels and a paper-friendly summary block.
 */

import fs from "node:fs";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

import {
  DEFAULT_TAGLINE,
  formatInrPlain,
  parseImageDataUrl,
  toPaise,
} from "./receipt.service.js";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const COLORS = {
  black: "#0d0d0f",
  blackSoft: "#17171a",
  gold: "#e8b84d",
  goldBright: "#ffd15c",
  goldDeep: "#b8862d",
  goldPale: "#f5ecd8",
  cream: "#fbf8f1",
  creamAlt: "#f6f1e6",
  line: "#e4dac4",
  ink: "#161616",
  body: "#3c3c3c",
  muted: "#7a7468",
  white: "#ffffff",
  success: "#1f7a4d",
};

const FONT_CANDIDATES = [
  {
    regular: process.env.RECEIPT_PDF_FONT,
    bold: process.env.RECEIPT_PDF_FONT_BOLD,
  },
  {
    regular: "C:/Windows/Fonts/segoeui.ttf",
    bold: "C:/Windows/Fonts/segoeuib.ttf",
  },
  {
    regular: "C:/Windows/Fonts/arial.ttf",
    bold: "C:/Windows/Fonts/arialbd.ttf",
  },
  {
    regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  },
  {
    regular: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    bold: "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  },
];

/** Keeps ₹/Unicode working on Windows and Linux; falls back to PDFKit fonts. */
function registerFonts(doc) {
  for (const candidate of FONT_CANDIDATES) {
    if (
      candidate.regular &&
      candidate.bold &&
      fs.existsSync(candidate.regular) &&
      fs.existsSync(candidate.bold)
    ) {
      try {
        doc.registerFont("DgRegular", candidate.regular);
        doc.registerFont("DgBold", candidate.bold);
        return { regular: "DgRegular", bold: "DgBold" };
      } catch {
        // Try the next candidate.
      }
    }
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" };
}

function money(paise) {
  // "Rs." avoids a missing rupee glyph in bundled PDF fonts.
  return `Rs. ${formatInrPlain(paise)}`;
}

function safeText(value, fallback = "") {
  const text = String(value ?? "")
    // The rupee sign is missing from PDFKit's bundled fonts, and gyms may type
    // it into footer copy. `money()` already uses "Rs.".
    .replace(/\u20b9/g, "Rs. ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function truncate(doc, font, size, text, width) {
  const source = safeText(text);
  if (!source) return "";
  doc.font(font).fontSize(size);
  if (doc.widthOfString(source) <= width) return source;
  let value = source;
  while (value.length > 1 && doc.widthOfString(`${value}…`) > width) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function drawTrackedLabel(doc, text, { x, y, width, color, font, size = 7, align = "left" }) {
  doc
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(text.toUpperCase(), x, y, {
      width,
      align,
      characterSpacing: 1.4,
      lineBreak: false,
    });
}

function drawPill(doc, text, { x, y, font, fill, color }) {
  doc.font(font).fontSize(7);
  const width = doc.widthOfString(text) + 20;
  doc.save();
  doc.roundedRect(x, y, width, 18, 9).fill(fill);
  doc
    .font(font)
    .fontSize(7)
    .fillColor(color)
    .text(text, x + 10, y + 5.5, { width: width - 20, align: "center", lineBreak: false });
  doc.restore();
  return width;
}

function drawLogo(doc, receipt, fonts) {
  const x = MARGIN;
  const y = 28;
  const size = 64;

  doc.save();
  doc.roundedRect(x, y, size, size, 12).fill(COLORS.white);
  doc.roundedRect(x, y, size, size, 12).lineWidth(1).strokeColor(COLORS.gold).stroke();

  const logo = parseImageDataUrl(receipt.gym?.logoDataUrl);
  if (logo) {
    try {
      doc.image(logo.buffer, x + 7, y + 7, {
        fit: [size - 14, size - 14],
        align: "center",
        valign: "center",
      });
    } catch {
      // A corrupt upload must not fail the receipt.
      drawMonogram(doc, receipt, fonts, x, y, size);
    }
  } else {
    drawMonogram(doc, receipt, fonts, x, y, size);
  }
  doc.restore();
}

function drawMonogram(doc, receipt, fonts, x, y, size) {
  const initials = safeText(receipt.gym?.gymName, "G")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  doc
    .font(fonts.bold)
    .fontSize(22)
    .fillColor(COLORS.goldDeep)
    .text(initials, x, y + size / 2 - 12, {
      width: size,
      align: "center",
      lineBreak: false,
    });
}

function contactLines(receipt) {
  const gym = receipt.gym ?? {};
  const lines = [];
  if (gym.address) lines.push(safeText(gym.address));
  if (gym.phone) lines.push(`Phone: ${gym.phone}`);
  if (gym.email) lines.push(`Email: ${gym.email}`);
  if (gym.website) lines.push(safeText(gym.website));
  return lines;
}

function drawHeader(doc, receipt, fonts) {
  doc.rect(0, 0, A4.width, 148).fill(COLORS.black);
  doc.rect(0, 0, A4.width, 3).fill(COLORS.gold);
  doc.rect(0, 145, A4.width, 3).fill(COLORS.goldDeep);

  drawLogo(doc, receipt, fonts);

  const nameX = MARGIN + 78;
  const nameWidth = 270;
  doc
    .font(fonts.bold)
    .fontSize(21)
    .fillColor(COLORS.white)
    .text(truncate(doc, fonts.bold, 21, receipt.gym?.gymName, nameWidth), nameX, 34, {
      width: nameWidth,
      lineBreak: false,
    });

  drawTrackedLabel(doc, safeText(receipt.gym?.tagline, DEFAULT_TAGLINE), {
    x: nameX,
    y: 62,
    width: nameWidth,
    color: COLORS.gold,
    font: fonts.bold,
    size: 7,
  });

  // Gold rule + "MEMBERSHIP" eyebrow under the name.
  doc.rect(nameX, 80, 42, 2).fill(COLORS.gold);
  drawTrackedLabel(doc, "Membership Payment Receipt", {
    x: nameX,
    y: 90,
    width: nameWidth,
    color: "#b9b3a6",
    font: fonts.regular,
    size: 7,
  });

  const lines = contactLines(receipt);
  const rightX = 360;
  const rightWidth = A4.width - MARGIN - rightX;
  let y = 30;
  for (const line of lines.slice(0, 4)) {
    doc
      .font(fonts.regular)
      .fontSize(7.5)
      .fillColor("#d9d5cc")
      .text(line, rightX, y, {
        width: rightWidth,
        align: "right",
        lineBreak: false,
        ellipsis: true,
      });
    y += 12;
  }
}

function drawTitleStrip(doc, receipt, fonts) {
  const y = 168;
  doc
    .font(fonts.bold)
    .fontSize(18)
    .fillColor(COLORS.ink)
    .text("Payment Receipt", MARGIN, y, { lineBreak: false });

  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      "Membership fee payment confirmation · computer generated",
      MARGIN,
      y + 24,
      { width: 300, lineBreak: false },
    );

  // Receipt number + date panel
  const panelX = 344;
  const panelY = 158;
  const panelW = A4.width - MARGIN - panelX;
  const panelH = 66;
  doc.save();
  doc.roundedRect(panelX, panelY, panelW, panelH, 10).fill(COLORS.cream);
  doc.roundedRect(panelX, panelY, panelW, panelH, 10).lineWidth(1).strokeColor(COLORS.line).stroke();
  doc.restore();

  drawTrackedLabel(doc, "Receipt No", {
    x: panelX + 14,
    y: panelY + 12,
    width: panelW / 2,
    color: COLORS.goldDeep,
    font: fonts.bold,
    size: 6.5,
  });
  doc
    .font(fonts.bold)
    .fontSize(12)
    .fillColor(COLORS.ink)
    .text(receipt.receiptNumber, panelX + 14, panelY + 24, {
      width: panelW / 2,
      lineBreak: false,
    });

  drawTrackedLabel(doc, "Issue date", {
    x: panelX + panelW / 2 + 6,
    y: panelY + 12,
    width: panelW / 2 - 20,
    color: COLORS.goldDeep,
    font: fonts.bold,
    size: 6.5,
    align: "right",
  });
  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(receipt.payment?.dateLabel ?? "—", panelX + panelW / 2 + 6, panelY + 26, {
      width: panelW / 2 - 20,
      align: "right",
      lineBreak: false,
    });

  const statusColor =
    receipt.status === "FULLY PAID"
      ? COLORS.success
      : receipt.status === "PARTIAL PAYMENT"
        ? COLORS.goldDeep
        : COLORS.ink;
  drawPill(doc, receipt.status, {
    x: panelX + 14,
    y: panelY + 42,
    font: fonts.bold,
    fill: statusColor,
    color: COLORS.white,
  });
}

function drawInfoCards(doc, receipt, fonts) {
  const top = 244;
  const gap = 15;
  const cardW = (CONTENT_WIDTH - gap) / 2;
  const cardH = 108;

  const card = (x, title) => {
    doc.save();
    doc.roundedRect(x, top, cardW, cardH, 10).fill(COLORS.cream);
    doc.roundedRect(x, top, cardW, cardH, 10).lineWidth(1).strokeColor(COLORS.line).stroke();
    doc.rect(x + 14, top + 22, 26, 2).fill(COLORS.gold);
    doc.restore();
    drawTrackedLabel(doc, title, {
      x: x + 14,
      y: top + 12,
      width: cardW - 28,
      color: COLORS.goldDeep,
      font: fonts.bold,
      size: 6.5,
    });
  };

  // Member
  card(MARGIN, "Billed to");
  const leftX = MARGIN + 14;
  const leftW = cardW - 28;
  doc
    .font(fonts.bold)
    .fontSize(12)
    .fillColor(COLORS.ink)
    .text(truncate(doc, fonts.bold, 12, receipt.member?.name, leftW), leftX, top + 32, {
      width: leftW,
      lineBreak: false,
    });
  const memberLines = [
    ["Member ID", receipt.member?.code],
    ["Mobile", receipt.member?.phone],
    ["Email", receipt.member?.email || "—"],
  ];
  let memberY = top + 51;
  for (const [label, value] of memberLines) {
    doc.font(fonts.regular).fontSize(7).fillColor(COLORS.muted).text(label, leftX, memberY, {
      width: 54,
      lineBreak: false,
    });
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(COLORS.body)
      .text(truncate(doc, fonts.regular, 8, value, leftW - 60), leftX + 56, memberY - 0.5, {
        width: leftW - 60,
        lineBreak: false,
      });
    memberY += 15;
  }

  // Membership
  const rightX = MARGIN + cardW + gap;
  card(rightX, "Membership");
  doc
    .font(fonts.bold)
    .fontSize(12)
    .fillColor(COLORS.ink)
    .text(truncate(doc, fonts.bold, 12, receipt.plan?.name, leftW), rightX + 14, top + 32, {
      width: leftW,
      lineBreak: false,
    });
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(COLORS.body)
    .text(receipt.plan?.durationLabel ?? "", rightX + 14, top + 50, {
      width: leftW,
      lineBreak: false,
    });

  const cols = [
    ["Valid from", receipt.membership?.startDateLabel ?? "—"],
    ["Valid till", receipt.membership?.endDateLabel ?? "—"],
  ];
  let colX = rightX + 14;
  for (const [label, value] of cols) {
    doc.font(fonts.regular).fontSize(7).fillColor(COLORS.muted).text(label, colX, top + 70, {
      width: 100,
      lineBreak: false,
    });
    doc.font(fonts.bold).fontSize(9).fillColor(COLORS.ink).text(value, colX, top + 82, {
      width: 100,
      lineBreak: false,
    });
    colX += 122;
  }
}

function drawFeeTable(doc, receipt, fonts) {
  const top = 372;
  const tableW = CONTENT_WIDTH;
  const labelX = MARGIN + 14;
  const amountWidth = 116;
  const amountX = MARGIN + tableW - 14 - amountWidth;

  // Header
  doc.rect(MARGIN, top, tableW, 27).fill(COLORS.black);
  doc.rect(MARGIN, top + 26, tableW, 1).fill(COLORS.gold);
  drawTrackedLabel(doc, "Description", {
    x: labelX,
    y: top + 10,
    width: 280,
    color: COLORS.gold,
    font: fonts.bold,
    size: 7,
  });
  drawTrackedLabel(doc, "Amount", {
    x: amountX,
    y: top + 10,
    width: amountWidth,
    color: COLORS.gold,
    font: fonts.bold,
    size: 7,
    align: "right",
  });

  const rows = [
    {
      label: receipt.fees?.description ?? "Membership fee",
      value: money(receipt.fees?.subtotalPaise),
      fill: COLORS.white,
      bold: false,
    },
  ];
  if (toPaise(receipt.fees?.discountPaise) > 0) {
    rows.push({
      label: "Discount",
      value: `- ${money(receipt.fees?.discountPaise)}`,
      fill: COLORS.white,
      bold: false,
    });
  }
  rows.push({
    label: "Total payable",
    value: money(receipt.fees?.totalPaise),
    fill: COLORS.goldPale,
    bold: true,
  });
  rows.push({
    label: "Paid with this receipt",
    value: money(receipt.payment?.amountPaise),
    fill: COLORS.white,
    bold: false,
  });
  rows.push({
    label: "Total paid for this membership",
    value: money(receipt.fees?.paidPaise),
    fill: COLORS.white,
    bold: false,
  });

  let y = top + 27;
  for (const row of rows) {
    const height = row.bold ? 27 : 24;
    doc.rect(MARGIN, y, tableW, height).fill(row.fill);
    doc.rect(MARGIN, y + height, tableW, 0.6).fill(COLORS.line);
    doc
      .font(row.bold ? fonts.bold : fonts.regular)
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(truncate(doc, row.bold ? fonts.bold : fonts.regular, 9, row.label, 340), labelX, y + height / 2 - 5, {
        width: 340,
        lineBreak: false,
      });
    doc
      .font(row.bold ? fonts.bold : fonts.regular)
      .fontSize(row.bold ? 10 : 9)
      .fillColor(COLORS.ink)
      .text(row.value, amountX, y + height / 2 - 5.5, {
        width: amountWidth,
        align: "right",
        lineBreak: false,
      });
    y += height;
  }

  // Balance band: black when settled, gold-tinted when outstanding.
  const balance = toPaise(receipt.fees?.balancePaise);
  const settled = balance <= 0;
  doc
    .rect(MARGIN, y, tableW, 34)
    .fill(settled ? COLORS.black : COLORS.goldPale);
  if (!settled) {
    doc.rect(MARGIN, y, 3, 34).fill(COLORS.goldDeep);
  }
  drawTrackedLabel(doc, settled ? "Balance due — fully paid" : "Balance due", {
    x: labelX,
    y: y + 13,
    width: 300,
    color: settled ? COLORS.gold : COLORS.goldDeep,
    font: fonts.bold,
    size: 7.5,
  });
  doc
    .font(fonts.bold)
    .fontSize(13)
    .fillColor(settled ? COLORS.goldBright : COLORS.ink)
    .text(money(balance), amountX, y + 10, {
      width: amountWidth,
      align: "right",
      lineBreak: false,
    });

  const tableBottom = y + 34;
  doc.rect(MARGIN, tableBottom, tableW, 1).fill(COLORS.line);
  return tableBottom;
}

function drawPaymentMeta(doc, receipt, fonts, top) {
  const height = 58;
  doc.save();
  doc.roundedRect(MARGIN, top, CONTENT_WIDTH, height, 8).fill(COLORS.creamAlt);
  doc.roundedRect(MARGIN, top, CONTENT_WIDTH, height, 8).lineWidth(0.8).strokeColor(COLORS.line).stroke();
  doc.restore();

  const columns = [
    ["Payment mode", receipt.payment?.modeLabel ?? "—"],
    ["Reference", safeText(receipt.payment?.reference, "—")],
    ["Paid at", `${receipt.payment?.timeLabel ?? ""} · ${receipt.payment?.dateLabel ?? ""}`],
  ];
  const colWidth = CONTENT_WIDTH / 3;
  columns.forEach(([label, value], index) => {
    const x = MARGIN + 14 + index * colWidth;
    drawTrackedLabel(doc, label, {
      x,
      y: top + 13,
      width: colWidth - 20,
      color: COLORS.muted,
      font: fonts.bold,
      size: 6.3,
    });
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(truncate(doc, fonts.bold, 9, value, colWidth - 20), x, top + 28, {
        width: colWidth - 20,
        lineBreak: false,
      });
  });
}

function drawFooterSection(doc, receipt, fonts, top, qrBuffer) {
  const leftW = 318;
  const qrSize = 88;
  const qrX = A4.width - MARGIN - qrSize;
  const qrY = top + 4;

  // Thank-you copy
  drawTrackedLabel(doc, "With gratitude", {
    x: MARGIN,
    y: top,
    width: leftW,
    color: COLORS.goldDeep,
    font: fonts.bold,
    size: 6.5,
  });
  doc.rect(MARGIN, top + 16, 34, 2).fill(COLORS.gold);
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(COLORS.body)
    .text(safeText(receipt.footerMessage), MARGIN, top + 27, {
      width: leftW,
      height: 62,
      lineGap: 2.5,
      ellipsis: true,
    });
  doc
    .font(fonts.regular)
    .fontSize(6.8)
    .fillColor(COLORS.muted)
    .text(
      "This is a computer-generated receipt and does not require a physical signature. Please retain it for your records.",
      MARGIN,
      top + 94,
      { width: leftW, lineGap: 1.5 },
    );

  // QR
  if (receipt.gym?.qrEnabled !== false && receipt.links?.pdf) {
    doc.save();
    doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 8).fill(COLORS.white);
    doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 8).lineWidth(0.8).strokeColor(COLORS.line).stroke();
    doc.restore();
    if (qrBuffer) {
      try {
        doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize] });
      } catch {
        // Ignore QR rendering failures; the receipt link is still in the API.
      }
    }
    doc
      .font(fonts.regular)
      .fontSize(6.5)
      .fillColor(COLORS.muted)
      .text("Scan to view / download receipt", qrX - 10, qrY + qrSize + 8, {
        width: qrSize + 20,
        align: "center",
      });
  }

  // Signature block (left of the QR, above the footer band).
  const sigY = top + 122;
  const sigW = 180;
  const sigX = qrX - sigW - 40;
  const signature = parseImageDataUrl(receipt.gym?.signatureDataUrl);
  if (signature) {
    try {
      doc.image(signature.buffer, sigX + 20, sigY - 26, {
        fit: [140, 30],
        align: "right",
      });
    } catch {
      // Ignore a corrupt signature image.
    }
  }
  doc.rect(sigX, sigY, sigW, 0.8).fill(COLORS.ink);
  doc
    .font(fonts.bold)
    .fontSize(8)
    .fillColor(COLORS.ink)
    .text(
      truncate(doc, fonts.bold, 8, receipt.gym?.authorizedSignatory, sigW),
      sigX,
      sigY + 6,
      { width: sigW, align: "center", lineBreak: false },
    );
  drawTrackedLabel(doc, "Authorised signature", {
    x: sigX,
    y: sigY + 18,
    width: sigW,
    color: COLORS.muted,
    font: fonts.regular,
    size: 6.2,
    align: "center",
  });
}

function drawBottomBand(doc, receipt, fonts) {
  const top = A4.height - 40;
  doc.rect(0, top, A4.width, 40).fill(COLORS.black);
  doc.rect(0, top, A4.width, 2).fill(COLORS.gold);

  const gym = receipt.gym ?? {};
  const contact = [gym.website, gym.phone, gym.email].filter(Boolean).join("   ·   ");
  doc
    .font(fonts.regular)
    .fontSize(7.5)
    .fillColor("#d9d5cc")
    .text(truncate(doc, fonts.regular, 7.5, contact, CONTENT_WIDTH - 170), MARGIN, top + 15, {
      width: CONTENT_WIDTH - 170,
      lineBreak: false,
    });
  doc
    .font(fonts.bold)
    .fontSize(6.6)
    .fillColor(COLORS.gold)
    .text("DARKGOLDGYM · MEMBERSHIP RECEIPT", A4.width - MARGIN - 165, top + 15, {
      width: 165,
      align: "right",
      characterSpacing: 0.8,
      lineBreak: false,
    });
}

/**
 * Renders the receipt to a Buffer. QR generation is the only async step.
 * @returns {Promise<Buffer>}
 */
export async function generateReceiptPdf(receipt) {
  const qrBuffer =
    receipt.gym?.qrEnabled !== false && receipt.links?.pdf
      ? await QRCode.toBuffer(receipt.links.pdf, {
          type: "png",
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0d0d0f", light: "#ffffff" },
        })
      : null;

  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: false,
    info: {
      Title: `Membership Receipt ${receipt.receiptNumber}`,
      Author: receipt.gym?.gymName ?? "DarkGoldGym",
      Subject: "Membership fee payment receipt",
      Keywords: "gym,membership,receipt,payment",
      CreationDate: new Date(),
    },
  });

  const fonts = registerFonts(doc);
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, A4.width, A4.height).fill(COLORS.white);

  drawHeader(doc, receipt, fonts);
  drawTitleStrip(doc, receipt, fonts);
  drawInfoCards(doc, receipt, fonts);
  const tableBottom = drawFeeTable(doc, receipt, fonts);
  drawPaymentMeta(doc, receipt, fonts, tableBottom + 18);
  drawFooterSection(doc, receipt, fonts, tableBottom + 96, qrBuffer);
  drawBottomBand(doc, receipt, fonts);

  doc.end();
  return done;
}
