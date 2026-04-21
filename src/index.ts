import "dotenv/config";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import cors from "cors";
import { corsOptions, devCorsOptions } from "./config/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { ogBotMiddleware } from "./middleware/ogBotMiddleware.js";
import { OrderController } from "./controllers/OrderController.js";
import { ReservationReaperService } from "./services/ReservationReaperService.js";
import { logger } from "./utils/logger.js";

import {
  userRoutes,
  productRoutes,
  inventoryRoutes,
  cartRoutes,
  orderRoutes,
  seoRoutes,
  storageRoutes,
  walletRoutes,
  dashboardRoutes,
} from "./routes/index.js";

const app = express();

const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";

let cachedDb: typeof mongoose | null = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  try {
    const db = await mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    cachedDb = db;
    logger.info("MongoDB connected successfully");
    return db;
  } catch (error) {
    logger.error("MongoDB connection error", { error: String(error) });
    cachedDb = null;
    throw error;
  }
}

app.use(
  cors(process.env.NODE_ENV === "production" ? corsOptions : devCorsOptions)
);

app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await connectToDatabase();
    ReservationReaperService.kickFromRequest();
    next();
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/orders/webhook/paystack",
  express.raw({ type: "application/json" }),
  OrderController.paystackWebhook
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

import { csrfProtection } from "./middleware/csrfMiddleware.js";
app.use(csrfProtection);

app.use(ogBotMiddleware);

app.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Order Management API",
    version: "1.0.0",
    endpoints: {
      users: "/api/users",
      products: "/api/products",
      inventory: "/api/inventory",
      cart: "/api/cart",
      orders: "/api/orders",
      wallets: "/api/wallets",
      storage: "/api/storage",
    },
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);

app.use("/", seoRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use(errorHandler);

if (process.env.NODE_ENV !== "production") {
  connectToDatabase()
    .then(() => {
      if (process.env.DISABLE_RESERVATION_REAPER !== "true") {
        const raw = Number(process.env.RESERVATION_REAPER_INTERVAL_MS);
        const intervalMs = Number.isFinite(raw) && raw > 0 ? raw : 60_000;
        setInterval(() => {
          void ReservationReaperService.runOnce({ quiet: true }).catch((err) =>
            logger.error("Reaper interval run failed", { error: String(err) })
          );
        }, intervalMs);
      }

      app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, {
          env: process.env.NODE_ENV || "development",
          cors:
            process.env.NODE_ENV !== "production"
              ? "development (all origins)"
              : "production (restricted)",
        });
      });
    })
    .catch((error) => {
      logger.error("Failed to start server", { error: String(error) });
      process.exit(1);
    });
}

export { app, connectToDatabase };
