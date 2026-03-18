import { Router } from "express";
import { UserController } from "../controllers/UserController.js";

/**
 * User Routes
 *
 * Maps HTTP endpoints to UserController methods.
 * Prefix: /api/users
 */
const router = Router();

// ───── Public ─────
router.post("/register", UserController.register);

// ───── Email Verification ─────
router.patch("/:userId/verify-email", UserController.verifyEmail);

// ───── Profile ─────
router.get("/:userId", UserController.getUserById);
router.get("/email/:email", UserController.getUserByEmail);
router.patch("/:userId/profile", UserController.updateProfile);

// ───── Admin: Account Status Transitions ─────
router.patch("/:userId/suspend", UserController.suspendUser);
router.patch("/:userId/reactivate", UserController.reactivateUser);
router.patch("/:userId/deactivate", UserController.deactivateUser);

export default router;
