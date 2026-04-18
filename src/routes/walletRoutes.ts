import { Router } from "express";
import { WalletController } from "../controllers/WalletController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
  repairBodySchema,
  reverseParamsSchema,
  reverseBodySchema,
  adjustBodySchema,
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

/* Admin transaction operations */

router.post(
  "/transactions/:transactionId/reverse",
  authMiddleware,
  requireRole("ADMIN"),
  validate(reverseParamsSchema, "params"),
  validate(reverseBodySchema, "body"),
  WalletController.reverse
);

router.post(
  "/:walletId/adjust",
  authMiddleware,
  requireRole("ADMIN"),
  validate(walletLedgerParamsSchema, "params"),
  validate(adjustBodySchema, "body"),
  WalletController.adjust
);

export default router;
