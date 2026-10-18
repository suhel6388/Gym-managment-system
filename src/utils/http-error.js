// Small structured-error type used by services and mapped to JSON responses
// by src/middleware/erros.js. Never carries stack traces to the client.

export class HttpError extends Error {
  /**
   * @param {number} statusCode HTTP status code (e.g. 409, 402)
   * @param {string} message Human-readable, safe-to-show message
   * @param {string} [code] Machine-readable code (e.g. SUBSCRIPTION_REQUIRED)
   * @param {object} [details] Extra structured payload
   */
  constructor(statusCode, message, code, details) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code ?? null;
    this.details = details ?? null;
  }
}

export const badRequest = (message, code, details) => new HttpError(400, message, code, details);
export const notFound = (message, code) => new HttpError(404, message, code);
export const conflict = (message, code, details) => new HttpError(409, message, code, details);
export const forbidden = (message, code) => new HttpError(403, message, code);
export const paymentRequired = (message, code, details) => new HttpError(402, message, code, details);
export const serviceUnavailable = (message, code) => new HttpError(503, message, code);
export const badGateway = (message, code) => new HttpError(502, message, code);
