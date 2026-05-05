import { z } from "zod";

export const approveRefundSchema = z.object({
  deductionAmount: z
    .number()
    .int()
    .min(0, "Deduction cannot be negative")
    .optional()
    .default(0),
  deductionReason: z.string().trim().min(1).optional(),
});

export const rejectRefundSchema = z.object({
  reason: z.string().trim().min(1, "Rejection reason is required"),
});

export const customerCancelSchema = z.object({
  reason: z.string().trim().min(1, "Cancellation reason is required"),
});

export const refundListQuerySchema = z.object({
  status: z
    .enum([
      "REQUESTED",
      "VALIDATING",
      "PENDING_APPROVAL",
      "AWAITING_REVIEW",
      "PROCESSING",
      "RETRYING",
      "GATEWAY_PENDING",
      "SETTLED",
      "COMPLETED",
      "FAILED",
      "REJECTED",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
