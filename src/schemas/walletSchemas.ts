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
