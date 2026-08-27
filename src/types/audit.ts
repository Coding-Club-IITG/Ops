export const AUDIT_ACTIONS = [
  "logs.export",
  "logs.diagnostics.view",
  "operators.upsert",
  "log_views.create",
  "log_views.update",
  "log_views.delete",
  "seed.run",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
