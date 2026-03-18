import { Router } from "express";
import { UserController } from "../controllers/index.js";
import { authMiddleware } from "../middleware/index.js";

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

// ───── Email Verification ─────
router.patch("/:userId/verify-email", UserController.verifyEmail);

// ───── Read Operations ─────
router.get("/me", authMiddleware, UserController.getMe);
router.get("/:userId", UserController.getUserById);
router.get("/email/:email", UserController.getUserByEmail);
router.patch("/:userId/profile", authMiddleware, UserController.updateProfile);

// ───── Admin: Account Status Transitions ─────
router.patch("/:userId/suspend", UserController.suspendUser);
router.patch("/:userId/reactivate", UserController.reactivateUser);
router.patch("/:userId/deactivate", UserController.deactivateUser);

export default router;
