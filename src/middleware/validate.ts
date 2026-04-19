import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

type ValidationTarget = "body" | "query" | "params";

export function validate(schema: ZodSchema, target: ValidationTarget = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors,
      });
      return;
    }

    if (target === "body") {
      req.body = result.data;
    } else {
      const source = req[target];
      for (const key of Object.keys(source)) {
        delete (source as Record<string, unknown>)[key];
      }
      Object.assign(source, result.data);
    }
    next();
  };
}
