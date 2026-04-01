import { Router } from "express";
import { StorageController } from "../controllers/StorageController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/upload-url", authMiddleware, StorageController.getUploadUrl);
router.post("/confirm", authMiddleware, StorageController.confirmUploads);
router.post("/rollback", authMiddleware, StorageController.rollbackUploads);

export default router;
