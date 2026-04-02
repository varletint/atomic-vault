import type { Request } from "express";
import { AuditService } from "../services/AuditService.js";
import type { AuditEntityType, AuditSeverity } from "../models/index.js";

export async function logAudit(params: {
  action: string;
  req?: Request;
  actor?: { userId?: string; email?: string; role?: string; isSystem?: boolean };
  entity?: { type: AuditEntityType; id?: string; name?: string };
  changes?: { before?: unknown; after?: unknown; changedFields?: string[] };
  result?: { success?: boolean; errorMessage?: string; errorCode?: string };
  metadata?: Record<string, unknown>;
  severity?: AuditSeverity;
  isSystem?: boolean;
}): Promise<void> {
  const actor =
    params.actor ??
    AuditService.getActorFromRequest(params.req, params.isSystem ?? false);

  const input: {
    action: string;
    actor: { userId?: string; email?: string; role?: string; isSystem?: boolean };
    entity?: { type: AuditEntityType; id?: string; name?: string };
    changes?: { before?: unknown; after?: unknown; changedFields?: string[] };
    request?: {
      requestId?: string;
      ipAddress?: string;
      userAgent?: string;
      endpoint?: string;
      method?: string;
    };
    result?: { success?: boolean; errorMessage?: string; errorCode?: string };
    metadata?: Record<string, unknown>;
    severity?: AuditSeverity;
  } = {
    action: params.action,
    actor,
  };
  if (params.entity) input.entity = params.entity;
  if (params.changes) input.changes = params.changes;
  const reqCtx = AuditService.getRequestContext(params.req);
  if (reqCtx) input.request = reqCtx;
  if (params.result) input.result = params.result;
  if (params.metadata) input.metadata = params.metadata;
  if (params.severity) input.severity = params.severity;

  await AuditService.log(input);
}

