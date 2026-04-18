import { z } from "zod";

const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id format");

export const walletLedgerParamsSchema = z.object({
  walletId: objectIdSchema,
});

export const walletLedgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const repairBodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
  confirm: z.boolean().optional().default(false),
});

export const reverseParamsSchema = z.object({
  transactionId: objectIdSchema,
});

export const reverseBodySchema = z.object({
  reason: z
    .string()
    .min(5, "Reason must be at least 5 characters")
    .max(500, "Reason must be at most 500 characters"),
  confirm: z.boolean().refine((v) => v === true, {
    message: "Destructive operation: confirm must be true",
  }),
});

export const adjustBodySchema = z.object({
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: z.number().int().min(1, "Amount must be at least 1 kobo"),
  reason: z
    .string()
    .min(5, "Reason must be at least 5 characters")
    .max(500, "Reason must be at most 500 characters"),
  confirm: z.boolean().refine((v) => v === true, {
    message: "Destructive operation: confirm must be true",
  }),
});
