export const AUDIT_ACTIONS = [
  "logs.export",
  "logs.diagnostics.view",
  "operators.upsert",
  "log_views.create",
  "log_views.update",
  "log_views.delete",
  "seed.run",
  "alerts.rule.upsert",
  "alerts.rule.delete",
  "alerts.mute.create",
  "alerts.mute.delete",
  "alerts.discord.test",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
