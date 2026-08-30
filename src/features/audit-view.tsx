"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AUDIT_ACTIONS } from "@/types/audit";
import { apiFetch } from "@/lib/api";
import { Pagination } from "@/components/Pagination";
import { formatIst, formatIstInput, parseIstInput } from "@/lib/formatters";
import { DEFAULT_PAGE_SIZE } from "@/lib/ops-constants";
import type { AuditEvent } from "@/types/ops.types";
import styles from "@/features/ops.module.scss";

export function AuditView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const offset = Number(params.get("offset") ?? 0) || 0;

  const replace = useCallback(
    (updates: Record<string, string | undefined>, resetPage = true) => {
      const next = new URLSearchParams(paramsKey);
      Object.entries(updates).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      if (resetPage) next.delete("offset");
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [paramsKey, pathname, router],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = Object.fromEntries(params.entries());
    void (
      apiFetch(
        "/audit",
        {},
        { ...query, limit: DEFAULT_PAGE_SIZE },
      ) as Promise<{
        data: AuditEvent[];
        total: number;
      }>
    )
      .then((response) => {
        if (!active) return;
        setEvents(response.data);
        setTotal(response.total);
        setError(null);
      })
      .catch(
        () => active && setError("Audit events are temporarily unavailable."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [params]);

  const page = Math.floor(offset / DEFAULT_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Administration</p>
          <h1 className={styles.heading}>Audit events</h1>
          <p className={styles.subheading}>
            Immutable operator actions with stored attributes.
          </p>
        </div>
      </div>
      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelBody}>
          <div className={styles.auditFilters}>
            <label className={styles.fieldLabel}>
              From (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("from"))}
                onChange={(event) =>
                  replace({ from: parseIstInput(event.target.value) })
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              To (IST)
              <input
                className={styles.input}
                type="datetime-local"
                value={formatIstInput(params.get("to"))}
                onChange={(event) =>
                  replace({ to: parseIstInput(event.target.value) })
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              Action
              <select
                className={styles.select}
                value={params.get("action") ?? ""}
                onChange={(event) =>
                  replace({ action: event.target.value || undefined })
                }
              >
                <option value="">All actions</option>
                {AUDIT_ACTIONS.map((action) => (
                  <option key={action}>{action}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Actor ID or email
              <input
                className={styles.input}
                value={params.get("actor") ?? ""}
                onChange={(event) =>
                  replace({ actor: event.target.value || undefined })
                }
              />
            </label>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Occurred (IST)</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Attributes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className={styles.mono}>
                      {formatIst(event.occurredAt)}
                    </td>
                    <td className={styles.mono}>{event.action}</td>
                    <td>
                      {event.operatorEmail ?? (
                        <span className={styles.muted}>
                          Legacy ID-only event
                        </span>
                      )}
                      <div className={styles.mono}>{event.operatorId}</div>
                    </td>
                    <td>
                      <details className={styles.attributeDetails}>
                        <summary>
                          {Object.keys(event.attributes).length} attributes
                        </summary>
                        <pre>{JSON.stringify(event.attributes, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !events.length && (
              <div className={styles.empty}>
                No audit events match these filters.
              </div>
            )}
            {loading && (
              <div className={styles.empty}>Loading audit events…</div>
            )}
          </div>
          <Pagination
            total={total}
            noun="events"
            page={page}
            pages={pages}
            onPrevious={() =>
              replace(
                { offset: String(Math.max(0, offset - DEFAULT_PAGE_SIZE)) },
                false,
              )
            }
            onNext={() =>
              replace({ offset: String(offset + DEFAULT_PAGE_SIZE) }, false)
            }
          />
        </div>
      </section>
    </main>
  );
}
