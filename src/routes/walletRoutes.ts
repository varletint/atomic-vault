import { Router } from "express";
import { WalletController } from "../controllers/WalletController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
} from "../schemas/walletSchemas.js";

const router = Router();

router.get(
  "/:walletId/ledger",
  authMiddleware,
  requireRole("ADMIN"),
  validate(walletLedgerParamsSchema, "params"),
  validate(walletLedgerQuerySchema, "query"),
  WalletController.getLedger
);

export default router;

