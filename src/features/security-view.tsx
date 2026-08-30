"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { StatCard } from "@/features/stat-card";
import { X } from "lucide-react";
import {
  formatIndianNumber,
  formatIst,
  formatIstInput,
  parseIstInput,
} from "@/lib/formatters";
import { DEFAULT_PAGE_SIZE } from "@/lib/ops-constants";
import type {
  SecurityEvent,
  SecurityEventType,
  SecurityStats,
} from "@/types/security";
import styles from "@/features/ops.module.scss";
import secStyles from "@/features/security-section.module.scss";

const EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  login_success: "Login Success",
  login_failure: "Login Failure",
  session_opened: "Session Open",
  session_closed: "Session Close",
  sudo_escalation: "Sudo Escalation",
  collector_heartbeat: "Heartbeat",
};

export function AdminSecuritySection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);

  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(
    null,
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const offset = Number(params.get("sec_offset") ?? 0) || 0;

  const replace = useCallback(
    (updates: Record<string, string | undefined>, resetPage = true) => {
      const next = new URLSearchParams(paramsKey);
      Object.entries(updates).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      if (resetPage) next.delete("sec_offset");
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [paramsKey, pathname, router],
  );

  // Fetch stats periodically
  useEffect(() => {
    let active = true;
    const fetchStats = () => {
      fetch("/api/security/stats")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data: SecurityStats | null) => {
          if (active && data) {
            setStats(data);
            setStatsError(false);
          }
        })
        .catch(() => {
          if (active) setStatsError(true);
        });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEvent(null);
    };
    document.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedEvent]);

  // Fetch events on filter change
  useEffect(() => {
    let active = true;
    setLoading(true);
    const searchParamsObj: Record<string, string> = {};
    if (params.get("sec_search"))
      searchParamsObj.search = params.get("sec_search")!;
    if (params.get("sec_eventType"))
      searchParamsObj.eventType = params.get("sec_eventType")!;
    if (params.get("sec_account"))
      searchParamsObj.account = params.get("sec_account")!;
    if (params.get("sec_sourceIp"))
      searchParamsObj.sourceIp = params.get("sec_sourceIp")!;
    if (params.get("sec_result"))
      searchParamsObj.result = params.get("sec_result")!;
    if (params.get("sec_from")) searchParamsObj.from = params.get("sec_from")!;
    if (params.get("sec_to")) searchParamsObj.to = params.get("sec_to")!;

    const search = new URLSearchParams({
      ...searchParamsObj,
      limit: String(DEFAULT_PAGE_SIZE),
      offset: String(offset),
    });

    fetch(`/api/security/events?${search.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((response: { events: SecurityEvent[]; total: number }) => {
        if (!active) return;
        setEvents(response.events);
        setTotal(response.total);
        setError(null);
      })
      .catch(() => {
        if (active) setError("Security events are temporarily unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params, offset]);

  const page = Math.floor(offset / DEFAULT_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  return (
    <div className={secStyles.container}>
      {/* Section Header */}
      <div className={secStyles.header}>
        <div>
          <h2 className={secStyles.title}>
            Server Logins & Security Telemetry
          </h2>
          <p className={secStyles.description}>
            SSH logins, authentication methods, source IPs, key fingerprints,
            and privilege escalations.
          </p>
        </div>
        <StatusBadge tone="warning">Admin only</StatusBadge>
      </div>

      {/* Freshness Banner */}
      <section className={styles.panel}>
        <div className={styles.panelBody}>
          <div className={secStyles.banner}>
            <div className={secStyles.bannerLeft}>
              <span className={secStyles.bannerLabel}>
                Login Collector Daemon:
              </span>
              <StatusBadge
                tone={
                  stats?.collectorFreshness === "live"
                    ? "success"
                    : stats?.collectorFreshness === "lagging"
                      ? "warning"
                      : "danger"
                }
              >
                <span>
                  {stats?.collectorFreshness
                    ? stats.collectorFreshness.toUpperCase()
                    : "CHECKING..."}
                </span>
              </StatusBadge>
              {stats?.lastHeartbeatAt && (
                <span className={secStyles.bannerMeta}>
                  Last Heartbeat: {formatIst(stats.lastHeartbeatAt)}
                </span>
              )}
            </div>
            {stats && (
              <div className={secStyles.bannerMeta}>
                Queue Spool Depth: <strong>{stats.queueDepth} pending</strong>
              </div>
            )}
          </div>
          {statsError && (
            <p className={styles.errorText} role="alert">
              Collector status is temporarily unavailable.
            </p>
          )}
        </div>
      </section>

      {/* Stat Cards */}
      <div className={`${styles.statGrid} ${styles.securityStatGrid}`}>
        <StatCard
          label="Logins"
          value={formatIndianNumber(stats?.totalLogins24h ?? 0)}
          detail="Last 24 hours"
        />
        <StatCard
          label="Unique source IPs"
          value={formatIndianNumber(stats?.uniqueIps24h ?? 0)}
          detail="Last 24 hours"
        />
        <StatCard
          label="Sudo escalations"
          value={formatIndianNumber(stats?.sudoEscalations24h ?? 0)}
          detail="Last 24 hours"
        />
        <StatCard
          label="Failed authentication"
          value={formatIndianNumber(stats?.failedLogins24h ?? 0)}
          detail="Last 24 hours"
        />
      </div>

      {/* Filters Panel */}
      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelBody}>
          <div className={styles.auditFilters}>
            <label className={styles.fieldLabel}>
              Search
              <input
                className={styles.input}
                type="text"
                placeholder="IP, account, key fingerprint, command..."
                value={params.get("sec_search") ?? ""}
                onChange={(e) =>
                  replace({ sec_search: e.target.value || undefined })
                }
              />
            </label>

            <label className={styles.fieldLabel}>
              Event Type
              <select
                className={styles.select}
                value={params.get("sec_eventType") ?? ""}
                onChange={(e) =>
                  replace({ sec_eventType: e.target.value || undefined })
                }
              >
                <option value="">All Events</option>
                <option value="login_success">Login Success</option>
                <option value="login_failure">Login Failure</option>
                <option value="session_opened">Session Opened</option>
                <option value="session_closed">Session Closed</option>
                <option value="sudo_escalation">Sudo Escalation</option>
              </select>
            </label>

            <label className={styles.fieldLabel}>
              Account
              <input
                className={styles.input}
                type="text"
                placeholder="root..."
                value={params.get("sec_account") ?? ""}
                onChange={(e) =>
                  replace({ sec_account: e.target.value || undefined })
                }
              />
            </label>

            <label className={styles.fieldLabel}>
              Source IP
              <input
                className={styles.input}
                type="text"
                inputMode="decimal"
                placeholder="172.16.101.50"
                value={params.get("sec_sourceIp") ?? ""}
                onChange={(e) =>
                  replace({ sec_sourceIp: e.target.value || undefined })
                }
              />
            </label>

            <label className={styles.fieldLabel}>
              Result
              <select
                className={styles.select}
                value={params.get("sec_result") ?? ""}
                onChange={(e) =>
                  replace({ sec_result: e.target.value || undefined })
                }
              >
                <option value="">All Results</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
              </select>
            </label>

            <label className={styles.fieldLabel}>
              From (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("sec_from"))}
                onChange={(e) =>
                  replace({ sec_from: parseIstInput(e.target.value) })
                }
              />
            </label>

            <label className={styles.fieldLabel}>
              To (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("sec_to"))}
                onChange={(e) =>
                  replace({ sec_to: parseIstInput(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
      </section>

      {/* Events Table */}
      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelHeader}>
          <h2>Recent security events</h2>
          <span className={styles.muted}>
            {formatIndianNumber(total)} recorded event{total === 1 ? "" : "s"}
          </span>
        </div>

        <div className={styles.panelBody}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.tableWrap} aria-busy={loading}>
            <table className={`${styles.table} ${secStyles.eventsTable}`}>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th>Source IP / Subnet</th>
                  <th>Authentication / Key</th>
                  <th>Summary / Command</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.eventId}>
                    <td className={secStyles.nowrapCell}>
                      {formatIst(event.occurredAt)}
                    </td>
                    <td>
                      <StatusBadge
                        tone={
                          event.eventType === "login_success"
                            ? "success"
                            : event.eventType === "login_failure"
                              ? "danger"
                              : event.eventType === "sudo_escalation"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        <span>
                          {EVENT_TYPE_LABELS[event.eventType] ??
                            event.eventType}
                        </span>
                      </StatusBadge>
                    </td>
                    <td>
                      <code>{event.account}</code>
                    </td>
                    <td>
                      {event.sourceIp ? (
                        <div>
                          <div>
                            <code className={secStyles.codeCell}>
                              {event.sourceIp}
                            </code>
                          </div>
                          {event.subnetClassification && (
                            <span className={secStyles.subnetTag}>
                              {event.subnetClassification}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={secStyles.emptyCell}>-</span>
                      )}
                    </td>
                    <td>
                      {event.authMethod ? (
                        <div className={secStyles.authDetail}>
                          <span>{event.authMethod}</span>
                          {event.keyFingerprint && (
                            <div className={secStyles.fingerprint}>
                              {event.keyFingerprint.slice(0, 20)}...
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className={secStyles.emptyCell}>-</span>
                      )}
                    </td>
                    <td className={secStyles.summaryCell}>
                      {event.command ? (
                        <code className={secStyles.codeCell}>
                          {event.command}
                        </code>
                      ) : (
                        <span>{event.summary}</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        tone={event.result === "success" ? "success" : "danger"}
                      >
                        <span>{event.result}</span>
                      </StatusBadge>
                    </td>
                    <td>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setSelectedEvent(event)}
                      >
                        View event
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && events.length === 0 && (
              <div className={styles.empty}>
                No security events match these filters.
              </div>
            )}
            {loading && events.length === 0 && (
              <div className={styles.empty}>Loading security events…</div>
            )}
          </div>

          <Pagination
            total={total}
            noun="events"
            page={page}
            pages={pages}
            onPrevious={() =>
              replace(
                {
                  sec_offset: String(Math.max(0, offset - DEFAULT_PAGE_SIZE)),
                },
                false,
              )
            }
            onNext={() =>
              replace({ sec_offset: String(offset + DEFAULT_PAGE_SIZE) }, false)
            }
          />
        </div>
      </section>

      {/* Event Details Modal */}
      {selectedEvent && (
        <div
          className={styles.drawerBackdrop}
          onClick={() => setSelectedEvent(null)}
          role="presentation"
        >
          <aside
            className={styles.drawer}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-event-dialog-title"
          >
            <div className={styles.drawerHeader}>
              <h2 id="security-event-dialog-title">Event Details</h2>
              <button
                ref={closeButtonRef}
                className={styles.secondaryButton}
                aria-label="Close security event detail"
                onClick={() => setSelectedEvent(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className={secStyles.modalBody}>
              <div>
                <strong>Event ID:</strong> <code>{selectedEvent.eventId}</code>
              </div>
              <div>
                <strong>Occurred At:</strong>{" "}
                {formatIst(selectedEvent.occurredAt)} (
                {selectedEvent.occurredAt})
              </div>
              <div>
                <strong>Event Type:</strong>{" "}
                {EVENT_TYPE_LABELS[selectedEvent.eventType]}
              </div>
              <div>
                <strong>Account:</strong> <code>{selectedEvent.account}</code>
              </div>
              {selectedEvent.sourceIp && (
                <div>
                  <strong>Source IP:</strong>{" "}
                  <code>{selectedEvent.sourceIp}</code> (
                  {selectedEvent.subnetClassification ?? "Unknown"})
                </div>
              )}
              {selectedEvent.reverseDns && (
                <div>
                  <strong>Reverse DNS:</strong>{" "}
                  <code>{selectedEvent.reverseDns}</code>
                </div>
              )}
              {selectedEvent.authMethod && (
                <div>
                  <strong>Auth Method:</strong> {selectedEvent.authMethod}
                </div>
              )}
              {selectedEvent.keyFingerprint && (
                <div>
                  <strong>Key Fingerprint:</strong>{" "}
                  <code>{selectedEvent.keyFingerprint}</code> (
                  {selectedEvent.keyType})
                </div>
              )}
              {selectedEvent.tty && (
                <div>
                  <strong>TTY:</strong> <code>{selectedEvent.tty}</code>
                </div>
              )}
              {selectedEvent.workingDirectory && (
                <div>
                  <strong>Working Directory:</strong>{" "}
                  <code>{selectedEvent.workingDirectory}</code>
                </div>
              )}
              {selectedEvent.command && (
                <div>
                  <strong>Command:</strong>
                  <pre className={secStyles.codeBlock}>
                    {selectedEvent.command}
                  </pre>
                </div>
              )}
              <div>
                <strong>Summary:</strong> {selectedEvent.summary}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
