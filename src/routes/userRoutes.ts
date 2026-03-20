import { Router } from "express";
import { UserController } from "../controllers/index.js";
import {
  authMiddleware,
  requireRole,
  requireSelfOrAdmin,
} from "../middleware/index.js";

/**
 * User Routes
 *
 * Maps HTTP endpoints to UserController methods.
 * Prefix: /api/users
 */
const router = Router();

// ───── Public ─────
router.post("/register", UserController.register);
router.post("/login", UserController.login);
router.post("/refresh", UserController.refreshTokens);
router.post("/logout", UserController.logout);

// ───── Email Verification (admin) ─────
router.patch(
  "/:userId/verify-email",
  authMiddleware,
  requireRole("ADMIN"),
  UserController.verifyEmail
);

// ───── Read Operations ─────
router.get("/me", authMiddleware, UserController.getMe);
router.get(
  "/:userId",
  authMiddleware,
  requireSelfOrAdmin({ type: "userId" }),
  UserController.getUserById
);
router.get(
  "/email/:email",
  authMiddleware,
  requireSelfOrAdmin({ type: "email" }),
  UserController.getUserByEmail
);
router.patch("/:userId/profile", authMiddleware, UserController.updateProfile);

// ───── Admin: Account Status Transitions ─────
const adminOnly = [authMiddleware, requireRole("ADMIN")] as const;

router.patch("/:userId/suspend", ...adminOnly, UserController.suspendUser);
router.patch("/:userId/reactivate", ...adminOnly, UserController.reactivateUser);
router.patch("/:userId/deactivate", ...adminOnly, UserController.deactivateUser);

export default router;
