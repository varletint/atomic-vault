import type { Request } from "express";
import { AuditLog, type AuditSeverity, type AuditEntityType } from "../models/index.js";
import { logger } from "../utils/logger.js";

type AuditActor = {
  userId?: string;
  email?: string;
  role?: string;
  isSystem?: boolean;
};

type AuditResult = {
  success?: boolean;
  errorMessage?: string;
  errorCode?: string;
};

type AuditRequest = {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
};

export class AuditService {
  static getRequestContext(req?: Request): AuditRequest | undefined {
    if (!req) return undefined;
    const reqIdHeader = req.headers["x-request-id"];
    const requestId =
      typeof reqIdHeader === "string"
        ? reqIdHeader
        : Array.isArray(reqIdHeader)
        ? reqIdHeader[0]
        : undefined;

    const ctx: AuditRequest = {};
    const ip = req.ip || req.socket?.remoteAddress || undefined;
    const userAgent = req.get("User-Agent") || undefined;
    const endpoint = req.originalUrl || req.url || undefined;
    const method = req.method || undefined;
    if (ip) ctx.ipAddress = ip;
    if (userAgent) ctx.userAgent = userAgent;
    if (endpoint) ctx.endpoint = endpoint;
    if (method) ctx.method = method;
    if (requestId) ctx.requestId = requestId;
    return ctx;
  }

  static getActorFromRequest(req?: Request, isSystem = false): AuditActor {
    const actor: AuditActor = { isSystem };
    if (!req?.user) return actor;
    actor.userId = req.user.userId;
    actor.email = req.user.email;
    actor.role = req.user.role;
    return actor;
  }

  static async log(input: {
    action: string;
    actor?: AuditActor;
    entity?: { type: AuditEntityType; id?: string; name?: string };
    changes?: { before?: unknown; after?: unknown; changedFields?: string[] };
    request?: AuditRequest;
    result?: AuditResult;
    metadata?: Record<string, unknown>;
    severity?: AuditSeverity;
  }): Promise<void> {
    try {
      const actor = input.actor ?? { isSystem: true };
      const result = input.result ?? { success: true };
      const doc: Record<string, unknown> = {
        action: input.action,
        actor,
        result,
        severity: input.severity ?? "info",
      };
      if (input.entity) doc.entity = input.entity;
      if (input.changes) doc.changes = input.changes;
      if (input.request) doc.request = input.request;
      if (input.metadata) doc.metadata = input.metadata;
      await AuditLog.create(doc);
    } catch (error) {
      logger.error("audit.log.failed", {
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

