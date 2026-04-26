import { Router } from "express";
import { WithdrawalController } from "../controllers/WithdrawalController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  initiateWithdrawalBodySchema,
  withdrawalParamsSchema,
  withdrawalListQuerySchema,
} from "../schemas/withdrawalSchemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  requireRole("ADMIN"),
  validate(initiateWithdrawalBodySchema, "body"),
  WithdrawalController.initiate
);

router.get(
  "/",
  authMiddleware,
  requireRole("ADMIN"),
  validate(withdrawalListQuerySchema, "query"),
  WithdrawalController.list
);

router.get(
  "/:withdrawalId",
  authMiddleware,
  requireRole("ADMIN"),
  validate(withdrawalParamsSchema, "params"),
  WithdrawalController.getById
);

export default router;
