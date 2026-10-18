// Simple in-memory sliding-window rate limiter for sensitive endpoints.
// Suitable for a single Node process. If the API is scaled horizontally,
// swap this for a shared store (e.g. Redis) — the middleware contract stays.
//
// Usage:
//   router.post("/trial", authenticate, rateLimit({ windowMs: 60*60*1000, max: 5 }), startTrial)

const buckets = new Map();
const MAX_BUCKETS = 50000;

// Periodically drop expired buckets so the map cannot grow unbounded.
const sweeper = setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  },
  5 * 60 * 1000,
);
sweeper.unref?.();

/**
 * @param {{ windowMs?: number, max?: number, message?: string, keyFn?: (req: any) => string }} options
 */
export function rateLimit({
  windowMs = 10 * 60 * 1000,
  max = 30,
  message = "Too many requests. Please try again later.",
  keyFn,
} = {}) {
  return (req, res, next) => {
    // Authenticated user id when available, else client IP.
    const key = keyFn ? keyFn(req) : req.user?.id || req.ip || "unknown";
    const now = Date.now();

    if (buckets.size > MAX_BUCKETS) {
      // Hard safety valve: reset rather than leak memory under abuse.
      buckets.clear();
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({
        error: message,
        code: "RATE_LIMITED",
        details: { retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) },
      });
    }
    next();
  };
}
