import type { CorsOptions } from "cors";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [
      // Production
      "https://adminvault.vercel.app",
      "https://atomic-oder.vercel.app",
      // Local dev
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      process.env.FRONTEND_URL || "",
    ].filter(Boolean);

/** Allow Vercel preview deployments (*.vercel.app) in addition to exact matches */
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true;
  // Allow any Vercel preview deployment for your projects
  if (origin.endsWith(".vercel.app")) return true;
  return false;
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Set-Cookie"],
  maxAge: 86400,
  optionsSuccessStatus: 200,
};

export const devCorsOptions: CorsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Set-Cookie"],
  optionsSuccessStatus: 200,
};
