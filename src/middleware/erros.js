export function notFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

export function errorHandler(err, req, res, next) {
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
