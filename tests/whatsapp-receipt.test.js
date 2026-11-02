import test from "node:test";
import assert from "node:assert/strict";

import {
  receiptDocumentFileName,
  sendReceiptDocument,
  WhatsAppNotConfiguredError,
} from "../src/services/whatsapp.service.js";

const receipt = {
  receiptNumber: "DG-0042",
  member: { name: "Priya Sharma" },
  gym: { gymName: "DarkGold Gym" },
  plan: { name: "Gold Monthly" },
  fees: { balancePaise: 300000 },
  payment: { amountPaise: 150000, modeLabel: "UPI" },
  footerMessage: "Thank you for choosing {gymName}!",
  whatsapp: { phone: "919876543210" },
  links: { pdf: "https://example.com/receipt.pdf" },
};

function configureWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  process.env.WHATSAPP_API_VERSION = "v21.0";
}

function clearWhatsApp() {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_API_VERSION;
}

test("receipt document filenames are safe for WhatsApp", () => {
  assert.equal(receiptDocumentFileName(receipt), "Receipt-DG-0042.pdf");
  assert.equal(
    receiptDocumentFileName({ receiptNumber: "DG/2026 0042" }),
    "Receipt-DG-2026-0042.pdf",
  );
});

test("WhatsApp uploads the actual PDF and sends it by media id", async (t) => {
  configureWhatsApp();
  t.after(clearWhatsApp);

  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/media")) {
      return new Response(JSON.stringify({ id: "media_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await sendReceiptDocument(receipt, {
    pdfBuffer: Buffer.from("%PDF-1.4 receipt"),
  });

  assert.equal(result.delivery, "media");
  assert.equal(result.messageId, "wamid.1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/1234567890\/media$/);
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof FormData);

  const message = JSON.parse(calls[1].init.body);
  assert.equal(message.to, "919876543210");
  assert.equal(message.type, "document");
  assert.equal(message.document.id, "media_123");
  assert.equal(message.document.filename, "Receipt-DG-0042.pdf");
  assert.match(message.document.caption, /Hello Priya Sharma!/);
  assert.match(message.document.caption, /Receipt No: DG-0042/);
});

test("WhatsApp falls back to the signed link when media upload fails", async (t) => {
  configureWhatsApp();
  t.after(clearWhatsApp);

  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/media")) {
      return new Response(JSON.stringify({ error: { message: "nope" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.2" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await sendReceiptDocument(receipt, {
    pdfBuffer: Buffer.from("%PDF-1.4 receipt"),
  });

  assert.equal(result.delivery, "link");
  const message = JSON.parse(calls[1].init.body);
  assert.equal(message.document.link, receipt.links.pdf);
  assert.equal(message.document.id, undefined);
});

test("WhatsApp is optional", async () => {
  clearWhatsApp();
  await assert.rejects(
    () => sendReceiptDocument(receipt, { pdfBuffer: Buffer.from("%PDF-1.4") }),
    (error) => error instanceof WhatsAppNotConfiguredError,
  );
});
