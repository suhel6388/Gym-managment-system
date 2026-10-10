import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth.js";
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
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
// Better Auth must run before express.json() so its request body is not consumed.
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json({ limit: "1mb" }));

app.get("/api/v1/health", (req, res) => res.json({ status: "ok" }));
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
