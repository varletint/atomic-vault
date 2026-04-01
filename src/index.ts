import "dotenv/config";
import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import cors from "cors";
import { corsOptions, devCorsOptions } from "./config/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { OrderController } from "./controllers/OrderController.js";

import {
  userRoutes,
  productRoutes,
  inventoryRoutes,
  cartRoutes,
  orderRoutes,
  seoRoutes,
  storageRoutes,
} from "./routes/index.js";

const app = express();

const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";
const isDevelopment = process.env.NODE_ENV !== "production";

app.use(isDevelopment ? cors(devCorsOptions) : cors(corsOptions));

// Paystack requires the raw request body for webhook signature verification.
// This MUST be mounted before `express.json()`.
app.post(
  "/api/orders/webhook/paystack",
  express.raw({ type: "application/json" }),
  OrderController.paystackWebhook
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

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
app.use("/api/storage", storageRoutes);

// Mount SEO routes at the root level
app.use("/", seoRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use(errorHandler);

let cachedDb: typeof mongoose | null = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  try {
    const db = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    cachedDb = db;
    console.log("MongoDB connected successfully");
    return db;
  } catch (error) {
    console.error(" MongoDB connection error:", error);
    throw error;
  }
}

if (process.env.NODE_ENV !== "production") {
  connectToDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(` Server running on port ${PORT}`);
        console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(
          ` CORS: ${
            isDevelopment
              ? "Development (all origins)"
              : "Production (restricted)"
          }`
        );
      });
    })
    .catch((error) => {
      console.error("Failed to start server:", error);
      process.exit(1);
    });
}

export { app, connectToDatabase };
