import { app, connectToDatabase } from "../dist/index.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

let isConnected = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isConnected) {
    try {
      await connectToDatabase();
      isConnected = true;
    } catch (error) {
      console.error("Database connection failed:", error);
      return res.status(500).json({
        success: false,
        message: "Database connection failed",
      });
    }
  }

  return new Promise((resolve, reject) => {
    app(req as any, res as any, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
}
