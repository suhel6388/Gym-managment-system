export function notFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

export function errorHandler(err, req, res, next) {
  // Structured errors thrown by services (HttpError or anything with a
  // numeric statusCode). `code` + `details` are echoed when present; the
  // stack is never sent to the client.
  if (typeof err?.statusCode === "number") {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.details) body.details = err.details;
    if (process.env.NODE_ENV !== "production") {
      console.error(`[${err.statusCode}] ${err.message}`, err.code ?? "");
    }
    return res.status(err.statusCode).json(body);
  }
  console.error(err);
  if (err?.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed", details: err.issues });
  }
  if (err?.code === "P2002") {
    return res.status(409).json({ error: "A record with this value already exists" });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }
  res.status(500).json({ error: "Internal server error" });
}
