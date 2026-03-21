import { z } from "zod";

export const adjustStockSchema = z.object({
  quantity: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: "Quantity cannot be zero" }),
});

export const stockQuantitySchema = z.object({
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});
