import { z } from "zod";

export const initiateWithdrawalBodySchema = z.object({
  walletId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid walletId"),
  amount: z.number().int().min(1, "Amount must be at least 1 kobo"),
  bankCode: z.string().min(1, "Bank code is required"),
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, "Account number must be 10 digits"),
  accountName: z.string().min(1, "Account name is required"),
  reason: z.string().optional(),
  idempotencyKey: z.string().min(1, "Idempotency key is required"),
});

export const withdrawalParamsSchema = z.object({
  withdrawalId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid withdrawalId"),
});

export const withdrawalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
});
