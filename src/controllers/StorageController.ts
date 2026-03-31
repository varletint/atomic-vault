import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { StorageService } from "../services/StorageService.js";

export class StorageController {
  /**
   * POST /api/storage/upload-url
   * Body: { folder: string, fileName: string, contentType: string }
   *
   * Returns a pre-signed URL the client can PUT to directly,
   * along with the tempKey (for rollback) and the final publicUrl.
   */
  static getUploadUrl = asyncHandler(async (req: Request, res: Response) => {
    const { folder, fileName, contentType } = req.body as {
      folder: string;
      fileName: string;
      contentType: string;
    };

    if (!folder || !fileName || !contentType) {
      res.status(400).json({
        success: false,
        message: "folder, fileName, and contentType are required.",
      });
      return;
    }

    const result = await StorageService.getTempUploadUrl(
      folder,
      fileName,
      contentType
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * POST /api/storage/confirm
   * Body: { moves: { tempKey: string, finalKey: string }[] }
   *
   * Promote temp objects to their permanent keys after
   * the parent entity (e.g. product) has been saved successfully.
   */
  static confirmUploads = asyncHandler(async (req: Request, res: Response) => {
    const { moves } = req.body as {
      moves: { tempKey: string; finalKey: string }[];
    };

    if (!Array.isArray(moves) || moves.length === 0) {
      res.status(400).json({
        success: false,
        message: "moves[] is required.",
      });
      return;
    }

    await Promise.all(
      moves.map((m) => StorageService.moveObject(m.tempKey, m.finalKey))
    );

    res.status(200).json({ success: true, message: "Uploads confirmed." });
  });

  /**
   * POST /api/storage/rollback
   * Body: { keys: string[] }
   *
   * Delete temp objects when entity creation fails.
   */
  static rollbackUploads = asyncHandler(async (req: Request, res: Response) => {
    const { keys } = req.body as { keys: string[] };

    if (!Array.isArray(keys) || keys.length === 0) {
      res.status(400).json({
        success: false,
        message: "keys[] is required.",
      });
      return;
    }

    await StorageService.deleteObjects(keys);

    res.status(200).json({ success: true, message: "Temp files deleted." });
  });
}
