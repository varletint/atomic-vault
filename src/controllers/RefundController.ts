import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { RefundService } from "../services/RefundService.js";
import { OrderService } from "../services/OrderService.js";
import { RefundRequest } from "../models/index.js";
import { ValidationError, NotFoundError } from "../utils/AppError.js";
import type { z } from "zod";
import type {
  approveRefundSchema,
  rejectRefundSchema,
  customerCancelSchema,
  refundListQuerySchema,
} from "../schemas/refundSchemas.js";

export class RefundController {
  /* ── Admin endpoints ── */

  static listRefunds = asyncHandler(async (req: Request, res: Response) => {
    const { status, page, limit } = req.query as unknown as z.infer<
      typeof refundListQuerySchema
    >;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [refunds, total] = await Promise.all([
      RefundRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("orderId", "totalAmount status items")
        .populate("userId", "name email")
        .lean(),
      RefundRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        refunds,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  static getRefund = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    const refund = await RefundRequest.findById(id)
      .populate("orderId")
      .populate("userId", "name email")
      .populate("originalTransactionId")
      .populate("refundTransactionId")
      .populate("reviewedBy", "name email")
      .lean();

    if (!refund) throw NotFoundError("Refund request");

    res.status(200).json({ success: true, data: refund });
  });

  static approveRefund = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const adminId = req.user?.userId;
    if (!adminId) throw ValidationError("Admin not authenticated.");

    const body = req.body as z.infer<typeof approveRefundSchema>;

    const refund = await RefundService.approveRefund({
      refundRequestId: id,
      deductionAmount: body.deductionAmount,
      deductionReason: body.deductionReason,
      adminId,
    });

    res.status(200).json({
      success: true,
      message: "Refund approved.",
      data: refund,
    });
  });

  static rejectRefund = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const adminId = req.user?.userId;
    if (!adminId) throw ValidationError("Admin not authenticated.");

    const body = req.body as z.infer<typeof rejectRefundSchema>;

    const refund = await RefundService.rejectRefund({
      refundRequestId: id,
      reason: body.reason,
      adminId,
    });

    res.status(200).json({
      success: true,
      message: "Refund rejected.",
      data: refund,
    });
  });

  static requeueRefund = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const adminId = req.user?.userId;
    if (!adminId) throw ValidationError("Admin not authenticated.");

    const refund = await RefundService.requeueFailed({
      refundRequestId: id,
      adminId,
    });

    res.status(200).json({
      success: true,
      message: "Refund requeued for processing.",
      data: refund,
    });
  });

  /* ── Customer endpoints ── */

  static getOrderRefundStatus = asyncHandler(
    async (req: Request, res: Response) => {
      const { orderId } = req.params as { orderId: string };
      const userId = req.user?.userId;
      if (!userId) throw ValidationError("User not authenticated.");

      const refund = await RefundRequest.findOne({ orderId })
        .select(
          "status refundAmount deductionAmount deductionReason originalAmount completedAt statusHistory createdAt"
        )
        .lean();

      if (!refund) throw NotFoundError("Refund request");

      res.status(200).json({ success: true, data: refund });
    }
  );

  static requestCancellation = asyncHandler(
    async (req: Request, res: Response) => {
      const { orderId } = req.params as { orderId: string };
      const userId = req.user?.userId;
      if (!userId) throw ValidationError("User not authenticated.");

      const body = req.body as z.infer<typeof customerCancelSchema>;

      const order = await OrderService.requestCancellation(
        orderId,
        userId,
        body.reason
      );

      res.status(200).json({
        success: true,
        message: "Order cancelled. Refund request created if applicable.",
        data: order,
      });
    }
  );
}
