import { Router } from "express";
import { WalletController } from "../controllers/WalletController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
  repairBodySchema,
} from "../schemas/walletSchemas.js";

const router = Router();

router.get(
  "/store",
  authMiddleware,
  requireRole("ADMIN"),
  WalletController.getStoreWallet
);

router.get(
  "/:walletId/reconcile",
  authMiddleware,
  requireRole("ADMIN"),
  validate(walletLedgerParamsSchema, "params"),
  WalletController.reconcile
);

router.post(
  "/:walletId/reconcile/repair",
  authMiddleware,
  requireRole("ADMIN"),
  validate(walletLedgerParamsSchema, "params"),
  validate(repairBodySchema, "body"),
  WalletController.repair
);

router.get(
  "/:walletId/ledger",
  authMiddleware,
  requireRole("ADMIN"),
  validate(walletLedgerParamsSchema, "params"),
  validate(walletLedgerQuerySchema, "query"),
  WalletController.getLedger
);

export default router;
