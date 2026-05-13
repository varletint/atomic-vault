import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { AuditLog, type IAuditLog } from "../models/AuditLog.js";

const router = Router();

/**
 * GET /audit-logs
 * Admin-only, paginated, filterable audit log viewer.
 */
router.get(
  "/",
  authMiddleware,
  requireRole("ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 25)
    );

    const action = req.query.action as string | undefined;
    const severity = req.query.severity as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const filter: Record<string, unknown> = {};
    if (action) filter.action = { $regex: action, $options: "i" };
    if (severity) filter.severity = severity;
    if (entityType) filter["entity.type"] = entityType;
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (filter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IAuditLog[]>(),
      AuditLog.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        logs,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

export default router;
