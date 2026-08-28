"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LOG_EVENT_SERVICES } from "@contract/project-registry";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import {
  formatIndianNumber,
  formatIst,
  formatIstInput,
  parseIstInput,
} from "@/lib/formatters";
import { DEFAULT_PAGE_SIZE } from "@/lib/ops-constants";
import type {
  AlertInstance,
  AlertMute,
  AlertRule,
  AlertRuleKey,
} from "@/types/ops.types";
import styles from "@/features/ops.module.scss";

const LABELS: Record<AlertRuleKey, string> = {
  http_5xx_rate: "HTTP 5xx rate",
  http_p95_latency: "HTTP p95 latency",
  application_errors: "Application errors",
  service_silence: "Service silence",
  pm2_process_down: "PM2 process down",
  pm2_restart_loop: "PM2 restart loop",
  host_cpu: "Host CPU",
  host_memory: "Host memory",
  host_disk: "Host disk",
  metrics_stale: "Metrics stale",
};
const SERVICE_RULES: AlertRuleKey[] = [
  "http_5xx_rate",
  "http_p95_latency",
  "application_errors",
  "service_silence",
  "pm2_process_down",
  "pm2_restart_loop",
];

function value(rule: AlertRuleKey, input: number | null) {
  if (input === null) return "-";
  if (["http_5xx_rate", "host_cpu", "host_memory", "host_disk"].includes(rule))
    return `${input.toFixed(1)}%`;
  if (rule === "http_p95_latency") return `${Math.round(input)} ms`;
  if (rule === "service_silence" || rule === "metrics_stale")
    return `${Math.round(input)} sec`;
  return formatIndianNumber(Math.round(input));
}

export function AlertsView({ admin }: { admin: boolean }) {
  const router = useRouter(),
    pathname = usePathname(),
    searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);
  const [alerts, setAlerts] = useState<AlertInstance[]>([]),
    [rules, setRules] = useState<AlertRule[]>([]),
    [mutes, setMutes] = useState<AlertMute[]>([]);
  const [total, setTotal] = useState(0),
    [failed, setFailed] = useState(0),
    [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const offset = Number(params.get("offset") ?? 0) || 0;
  const replace = useCallback(
    (updates: Record<string, string | undefined>, reset = true) => {
      const next = new URLSearchParams(paramsKey);
      Object.entries(updates).forEach(([k, v]) =>
        v ? next.set(k, v) : next.delete(k),
      );
      if (reset) next.delete("offset");
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [paramsKey, pathname, router],
  );
  const load = useCallback(async () => {
    try {
      const query = Object.fromEntries(params.entries());
      const [alertResponse, ruleResponse, statusResponse] = await Promise.all([
        apiFetch(
          "/alerts",
          {},
          { ...query, limit: DEFAULT_PAGE_SIZE },
        ) as Promise<{
          data: AlertInstance[];
          total: number;
          mutes: AlertMute[];
          failedDeliveries: number;
        }>,
        apiFetch("/alert-rules") as Promise<{ data: AlertRule[] }>,
        admin
          ? (apiFetch("/alerts/discord/test") as Promise<{
              configured: boolean;
            }>)
          : Promise.resolve(null),
      ]);
      setAlerts(alertResponse.data);
      setTotal(alertResponse.total);
      setMutes(alertResponse.mutes);
      setFailed(alertResponse.failedDeliveries);
      setRules(ruleResponse.data);
      if (statusResponse) setConfigured(statusResponse.configured);
      setError(null);
    } catch {
      setError("Alert data is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [admin, params]);
  useEffect(() => {
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      setNotice(message);
      setError(null);
      await load();
    } catch {
      setError("The alert action failed.");
    }
  };
  const page = Math.floor(offset / DEFAULT_PAGE_SIZE) + 1,
    pages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Operational response</p>
          <h1 className={styles.heading}>Alerts</h1>
          <p className={styles.subheading}>
            Sustained service and host conditions with durable Discord delivery.
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge
            tone={
              failed ? "danger" : configured === false ? "warning" : "success"
            }
          >
            {!admin
              ? "Alert evaluation active"
              : failed
                ? `${failed} failed deliveries`
                : configured === false
                  ? "Discord not configured"
                  : "Discord connected"}
          </StatusBadge>
          {admin && (
            <button
              className={styles.secondaryButton}
              disabled={!configured}
              onClick={() =>
                void act(
                  () => apiFetch("/alerts/discord/test", { method: "POST" }),
                  "Discord test message sent.",
                )
              }
            >
              Send test
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p className={styles.successMessage}>{notice}</p>}
      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelBody}>
          <div className={styles.alertFilters}>
            <label className={styles.fieldLabel}>
              Status
              <select
                className={styles.select}
                value={params.get("status") ?? ""}
                onChange={(e) =>
                  replace({ status: e.target.value || undefined })
                }
              >
                <option value="">All statuses</option>
                <option>firing</option>
                <option>pending</option>
                <option>resolved</option>
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Severity
              <select
                className={styles.select}
                value={params.get("severity") ?? ""}
                onChange={(e) =>
                  replace({ severity: e.target.value || undefined })
                }
              >
                <option value="">All severities</option>
                <option>critical</option>
                <option>warning</option>
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Rule
              <select
                className={styles.select}
                value={params.get("ruleKey") ?? ""}
                onChange={(e) =>
                  replace({ ruleKey: e.target.value || undefined })
                }
              >
                <option value="">All rules</option>
                {Object.entries(LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Target
              <select
                className={styles.select}
                value={params.get("target") ?? ""}
                onChange={(e) =>
                  replace({ target: e.target.value || undefined })
                }
              >
                <option value="">All targets</option>
                <option value="host">host</option>
                {LOG_EVENT_SERVICES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              From (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("from"))}
                onChange={(e) =>
                  replace({ from: parseIstInput(e.target.value) })
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              To (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("to"))}
                onChange={(e) => replace({ to: parseIstInput(e.target.value) })}
              />
            </label>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Alert</th>
                  <th>Target</th>
                  <th>Observed / threshold</th>
                  <th>Started</th>
                  <th>Resolved</th>
                  {admin && <th>Notifications</th>}
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const mute = mutes.find((m) => m.target === alert.target);
                  return (
                    <tr key={alert.id}>
                      <td>
                        <StatusBadge
                          tone={
                            alert.status === "resolved"
                              ? "success"
                              : alert.severity === "critical"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {alert.status}
                        </StatusBadge>
                      </td>
                      <td>
                        <strong>{LABELS[alert.ruleKey]}</strong>
                        <div className={styles.muted}>
                          {alert.resolutionReason ?? alert.summary}
                        </div>
                      </td>
                      <td className={styles.mono}>{alert.target}</td>
                      <td className={styles.mono}>
                        {value(alert.ruleKey, alert.value)} /{" "}
                        {value(alert.ruleKey, alert.threshold)}
                      </td>
                      <td>{formatIst(alert.firedAt ?? alert.pendingSince)}</td>
                      <td>
                        {alert.resolvedAt ? formatIst(alert.resolvedAt) : "-"}
                      </td>
                      {admin && (
                        <td>
                          {mute ? (
                            <button
                              className={styles.secondaryButton}
                              onClick={() =>
                                void act(
                                  () =>
                                    apiFetch(
                                      "/alert-mutes",
                                      { method: "DELETE" },
                                      { target: alert.target },
                                    ),
                                  `${alert.target} unmuted.`,
                                )
                              }
                            >
                              Unmute
                            </button>
                          ) : (
                            <MuteButton target={alert.target} act={act} />
                          )}
                          <div className={styles.muted}>
                            {alert.lastDeliveryStatus ?? "not sent"}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && !alerts.length && (
              <div className={styles.empty}>No alerts match these filters.</div>
            )}
            {loading && !alerts.length && (
              <div className={styles.empty}>Loading alerts…</div>
            )}
          </div>
          <div className={styles.pagination}>
            <span className={styles.muted}>
              {formatIndianNumber(total)} alerts · page {page} of {pages}
            </span>
            <button
              className={styles.secondaryButton}
              disabled={page <= 1}
              onClick={() =>
                replace(
                  { offset: String(Math.max(0, offset - DEFAULT_PAGE_SIZE)) },
                  false,
                )
              }
            >
              Previous
            </button>
            <button
              className={styles.secondaryButton}
              disabled={page >= pages}
              onClick={() =>
                replace({ offset: String(offset + DEFAULT_PAGE_SIZE) }, false)
              }
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <RulesPanel rules={rules} admin={admin} act={act} />
    </main>
  );
}

function MuteButton({
  target,
  act,
}: {
  target: string;
  act: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [duration, setDuration] = useState("1h"),
    [reason, setReason] = useState("");
  if (!open)
    return (
      <button className={styles.secondaryButton} onClick={() => setOpen(true)}>
        Mute target
      </button>
    );
  return (
    <div className={styles.inlineAction}>
      <select
        className={styles.select}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      >
        <option value="1h">1 hour</option>
        <option value="4h">4 hours</option>
        <option value="24h">24 hours</option>
        <option value="indefinite">Indefinite</option>
      </select>
      <input
        className={styles.input}
        placeholder="Required reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className={styles.button}
        disabled={!reason.trim()}
        onClick={() =>
          void act(
            () =>
              apiFetch("/alert-mutes", {
                method: "POST",
                body: JSON.stringify({ target, duration, reason }),
              }),
            `${target} muted.`,
          ).then(() => setOpen(false))
        }
      >
        Apply
      </button>
    </div>
  );
}

function RulesPanel({
  rules,
  admin,
  act,
}: {
  rules: AlertRule[];
  admin: boolean;
  act: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [newTarget, setNewTarget] = useState<string>(LOG_EVENT_SERVICES[0]),
    [newKey, setNewKey] = useState<AlertRuleKey>(SERVICE_RULES[0]);
  const addOverride = () => {
    const base = rules.find((r) => r.ruleKey === newKey && r.target === "*");
    if (!base) return Promise.resolve();
    return act(
      () =>
        apiFetch("/alert-rules", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            target: newTarget,
            updatedBy: undefined,
            updatedAt: undefined,
          }),
        }),
      "Service override created.",
    );
  };
  return (
    <section
      className={`${styles.panel} ${styles.panelWide} ${styles.alertRules}`}
    >
      <div className={styles.panelHeader}>
        <h2>Alert rules</h2>
        <span className={styles.muted}>
          Global defaults and service overrides
        </span>
      </div>
      <div className={styles.panelBody}>
        {admin && (
          <div className={styles.ruleOverride}>
            <label className={styles.fieldLabel}>
              Service
              <select
                className={styles.select}
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
              >
                {LOG_EVENT_SERVICES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Rule
              <select
                className={styles.select}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value as AlertRuleKey)}
              >
                {SERVICE_RULES.map((k) => (
                  <option key={k} value={k}>
                    {LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.secondaryButton}
              onClick={() => void addOverride()}
            >
              Add/update override
            </button>
          </div>
        )}
        <div className={styles.ruleGrid}>
          {rules.map((rule) => (
            <RuleEditor
              key={`${rule.ruleKey}:${rule.target}`}
              rule={rule}
              admin={admin}
              act={act}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RuleEditor({
  rule,
  admin,
  act,
}: {
  rule: AlertRule;
  admin: boolean;
  act: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(rule);
  useEffect(() => setDraft(rule), [rule]);
  const set = <K extends keyof AlertRule>(key: K, input: AlertRule[K]) =>
    setDraft((current) => ({ ...current, [key]: input }));
  return (
    <article className={styles.ruleCard}>
      <div className={styles.panelHeader}>
        <div>
          <strong>{LABELS[rule.ruleKey]}</strong>
          <div className={styles.mono}>
            {rule.target === "*" ? "all services" : rule.target}
          </div>
        </div>
        <StatusBadge
          tone={
            !draft.enabled
              ? "neutral"
              : draft.severity === "critical"
                ? "danger"
                : "warning"
          }
        >
          {draft.enabled ? draft.severity : "disabled"}
        </StatusBadge>
      </div>
      <div className={styles.ruleFields}>
        <label className={styles.fieldLabel}>
          Enabled
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!admin}
            onChange={(e) => set("enabled", e.target.checked)}
          />
        </label>
        <label className={styles.fieldLabel}>
          Severity
          <select
            className={styles.select}
            disabled={!admin}
            value={draft.severity}
            onChange={(e) =>
              set("severity", e.target.value as AlertRule["severity"])
            }
          >
            <option>warning</option>
            <option>critical</option>
          </select>
        </label>
        {[
          { k: "threshold", l: "Threshold" },
          { k: "windowSeconds", l: "Window (sec)" },
          { k: "forSeconds", l: "Sustain (sec)" },
          { k: "reminderSeconds", l: "Reminder (sec)" },
          { k: "minimumCount", l: "Minimum count" },
        ].map((item) => (
          <label className={styles.fieldLabel} key={item.k}>
            {item.l}
            <input
              className={styles.input}
              type="number"
              min="0"
              disabled={!admin}
              value={draft[item.k as keyof AlertRule] as number}
              onChange={(e) =>
                set(item.k as keyof AlertRule, Number(e.target.value) as never)
              }
            />
          </label>
        ))}
        {admin && (
          <div className={styles.inlineActions}>
            <button
              className={styles.button}
              onClick={() =>
                void act(
                  () =>
                    apiFetch("/alert-rules", {
                      method: "POST",
                      body: JSON.stringify({
                        ...draft,
                        updatedBy: undefined,
                        updatedAt: undefined,
                      }),
                    }),
                  `${LABELS[rule.ruleKey]} saved.`,
                )
              }
            >
              Save rule
            </button>
            {rule.target !== "*" && rule.target !== "host" && (
              <button
                className={styles.secondaryButton}
                onClick={() =>
                  void act(
                    () =>
                      apiFetch(
                        "/alert-rules",
                        { method: "DELETE" },
                        { ruleKey: rule.ruleKey, target: rule.target },
                      ),
                    "Service override removed.",
                  )
                }
              >
                Use global
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
