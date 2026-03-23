import { Router } from "express";
import { UserController } from "../controllers/index.js";
import {
  authMiddleware,
  requireRole,
  requireSelfOrAdmin,
} from "../middleware/index.js";
import { validate } from "../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  reasonSchema,
  updateProfileSchema,
} from "../schemas/userSchemas.js";

const router = Router();

router.post("/register", validate(registerSchema), UserController.register);
router.post("/login", validate(loginSchema), UserController.login);
router.post("/refresh", UserController.refreshTokens);
router.post("/logout", UserController.logout);

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  UserController.requestPasswordReset
);
router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  UserController.resetPassword
);

router.patch(
  "/:userId/verify-email",
  authMiddleware,
  requireRole("ADMIN"),
  UserController.verifyEmail
);

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
router.patch(
  "/:userId/profile",
  authMiddleware,
  validate(updateProfileSchema),
  UserController.updateProfile
);

const adminOnly = [authMiddleware, requireRole("ADMIN")] as const;

router.patch(
  "/:userId/suspend",
  ...adminOnly,
  validate(reasonSchema),
  UserController.suspendUser
);
router.patch(
  "/:userId/reactivate",
  ...adminOnly,
  validate(reasonSchema),
  UserController.reactivateUser
);
router.patch(
  "/:userId/deactivate",
  ...adminOnly,
  validate(reasonSchema),
  UserController.deactivateUser
);

export default router;
