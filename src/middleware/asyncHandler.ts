import type { Request, Response, NextFunction } from "express";

/**
 * asyncHandler
 *
 * Wraps an async Express route handler so that any rejected promise
 * is automatically forwarded to Express's error middleware via next().
 *
 * This eliminates the need for try/catch in every controller method.
 *
 * Usage:
 *   router.post("/register", asyncHandler(async (req, res) => {
 *     const user = await UserService.register(req.body);
 *     res.status(201).json({ success: true, data: user });
 *   }));
 */
type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export const asyncHandler = (fn: AsyncRouteHandler) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};
