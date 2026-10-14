import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.route.js";
import memberRoutes from "./routes/members.route.js";
import planRoutes from "./routes/plans.route.js";
import membershipRoutes from "./routes/membership.routes.js";
import paymentRoutes from "./routes/payment.route.js";
import expenseRoutes from "./routes/expenses.route.js";
import reportRoutes from "./routes/reports.routes.js";
import { notFound, errorHandler } from "./middleware/errors.js";

const app = express();
app.use(helmet());
app.use(express.static("public"));
const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ 
  origin: clientOrigins, 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
   credentials: true,
}));
// Better Auth must run before express.json() so its request body is not consumed.
app.all("/api/auth/*", toNodeHandler(auth));
app.use(express.json());

app.get("/api/v1/health", (req, res) => res.json({ status: "ok",
  message: "Api server is working now start testing",
 }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/members", memberRoutes);
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/memberships", membershipRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
