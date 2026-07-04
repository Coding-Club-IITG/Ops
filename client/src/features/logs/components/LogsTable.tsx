"use client";

import { Fragment, useState } from "react";
import { Log } from "@/types/logs.types";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { wrap } from "module";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type FieldName = "@timestamp" | "message" | "level" | "http.method" | "http.status" | "request_id" | "latency_ms" | "service" | "region";

interface LogsTableProps {
  logs: Log[];
  loading?: boolean;
  total?: number;
  currentPage?: number;
  totalPages?: number;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  selectedFields?: FieldName[];
  onSelectedFieldsChange?: (fields: FieldName[]) => void;
  isLive?: boolean;
}

const DEFAULT_FIELDS: FieldName[] = ["@timestamp", "message", "level", "http.method", "http.status"];
const ALL_FIELDS: FieldName[] = ["@timestamp", "message", "level", "http.method", "http.status", "request_id", "latency_ms"];

const FIELD_TO_LABEL: Record<FieldName, string> = {
  "@timestamp": "@timestamp",
  "message": "message",
  "level": "level",
  "http.method": "method",
  "http.status": "status",
  "request_id": "request_id",
  "latency_ms": "latency",
  "service": "service",
  "region": "region",
};

const FIELD_TO_PROPERTY: Partial<Record<FieldName, keyof Log>> = {
  "@timestamp": "timestamp",
  "message": "message",
  "level": "level",
  "http.method": "method",
  "http.status": "status_code",
  "request_id": "id",
  "latency_ms": "response_time",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatTimestamp(ts: string) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return { date, time: `${time}.${ms}` };
}

function LevelBadge({ level }: { level: string }) {
  const upper = level.toUpperCase();
  const styles: Record<string, React.CSSProperties> = {
    INFO: {
      background: "var(--color-secondary-container)",
      color: "var(--color-primary)",
    },
    WARN: {
      background: "#fff3cd",
      color: "#856404",
    },
    WARNING: {
      background: "#fff3cd",
      color: "#856404",
    },
    ERROR: {
      background: "var(--color-error-container)",
      color: "var(--color-error)",
    },
    DEBUG: {
      background: "var(--color-surface-container-high)",
      color: "var(--color-on-surface-variant)",
    },
  };

  return (
    <span
      style={{
        ...(styles[upper] ?? styles["INFO"]),
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "0.2rem 0.55rem",
        borderRadius: "0.25rem",
        display: "inline-block",
        minWidth: 44,
        textAlign: "center",
      }}>
      {upper}
    </span>
  );
}

function StatusCode({ code }: { code: number }) {
  const color =
    code >= 500
      ? "var(--color-error)"
      : code >= 400
        ? "#d97706"
        : code >= 200 && code < 300
          ? "var(--color-success)"
          : "var(--color-on-surface-variant)";

  return (
    <span style={{ color, fontWeight: 600, fontSize: "0.875rem" }}>{code}</span>
  );
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontWeight: 700,
        color: "var(--color-on-surface)",
        letterSpacing: "0.02em",
      }}>
      {method}
    </span>
  );
}

// ─────────────────────────────────────────────
// Expanded row detail
// ─────────────────────────────────────────────
function ExpandedRow({ log }: { log: Log }) {
  return (
    <tr style={{ background: "var(--color-surface-container-low)" }}>
      <td colSpan={7} style={{ padding: "0 0 0 48px" }}>
        <div
          style={{
            padding: "0.75rem 1.5rem 0.75rem 0",
            display: "flex",
            gap: "3rem",
          }}>
          {/* Left meta */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              minWidth: 280,
            }}>
            <MetaRow
              label="User Agent"
              value="Mozilla/5.0 (Macintosh; Intel Mac OS X)"
            />
            <MetaRow label="Duration" value={`${log.response_time}ms`} />
          </div>
          {/* Right meta */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              flex: 1,
            }}>
            <MetaRow label="Remote IP" value="—" />
            <MetaRow label="Trace ID" value={`tr-${log.id}-abc`} />
          </div>
        </div>

        {/* Full message */}
        <div style={{ padding: "0 1.5rem 0.75rem 0" }}>
          <span
            className="label-sm"
            style={{ display: "block", marginBottom: "0.375rem" }}>
            Full Message
          </span>
          <pre
            style={{
              background: "var(--color-surface-container)",
              borderRadius: "0.25rem",
              padding: "0.625rem 0.875rem",
              fontSize: "0.75rem",
              color: "var(--color-on-surface)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              lineHeight: 1.6,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              boxShadow: "inset 0 0 0 1px rgba(195,198,214,0.15)",
            }}>
            {JSON.stringify(
              {
                event: log.url,
                status: log.status_code,
                level: log.level,
                message: log.message,
                latency: log.response_time,
                timestamp: log.timestamp,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </td>
    </tr>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
      <span className="label-sm" style={{ minWidth: 90, flexShrink: 0 }}>
        {label}:
      </span>
      <span
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-on-surface-variant)",
        }}>
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Field sidebar
// ─────────────────────────────────────────────
interface FieldSidebarProps {
  selectedFields: FieldName[];
  onFieldsChange: (fields: FieldName[]) => void;
  availableFields: FieldName[];
}

function FieldSidebar({
  selectedFields,
  onFieldsChange,
  availableFields,
}: FieldSidebarProps) {
  const toggle = (field: FieldName) => {
    if (selectedFields.includes(field)) {
      if (selectedFields.length > 1) {
        onFieldsChange(selectedFields.filter((f) => f !== field));
      }
    } else {
      onFieldsChange([...selectedFields, field]);
    }
  };

  return (
    <div
      style={{
        width: 168,
        flexShrink: 0,
        paddingTop: "0.75rem",
        paddingRight: "1.25rem",
        borderRight: "1px solid rgba(195,198,214,0.15)",
      }}>
      {/* Selected fields */}
      <p
        className="label-sm"
        style={{ marginBottom: "0.5rem", paddingLeft: "0.25rem" }}>
        Selected Fields
      </p>
      <div 
      className="flex-wrap z-5"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          marginBottom: "1.25rem",
        }}>
        {selectedFields.map((f) => (
          <button
            key={f}
            onClick={() => toggle(f)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.25rem 0.375rem",
              borderRadius: "0.25rem",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background =
                "var(--color-surface-container-high)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "0.2rem",
                background: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
              <Check size={9} color="#fff" strokeWidth={3} />
            </span>
            <span
              style={{ fontSize: "0.75rem", color: "var(--color-on-surface)" }}>
              {FIELD_TO_LABEL[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Available fields */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: "0.25rem",
          marginBottom: "0.5rem",
        }}>
        <p className="label-sm" style={{ margin: 0 }}>
          Available Fields
        </p>
        <span
          style={{
            fontSize: "0.6rem",
            fontWeight: 700,
            background: "var(--color-surface-container-high)",
            color: "var(--color-on-surface-variant)",
            padding: "0.1rem 0.35rem",
            borderRadius: "9999px",
          }}>
          {availableFields.length}
        </span>
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {availableFields.map((f) => (
          <button
            key={f}
            onClick={() => toggle(f)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.25rem 0.375rem",
              borderRadius: "0.25rem",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background =
                "var(--color-surface-container-high)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "0.2rem",
                border: "1.5px solid rgba(195,198,214,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
              <Plus
                size={9}
                style={{ color: "var(--color-on-surface-variant)" }}
                strokeWidth={2.5}
              />
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-on-surface-variant)",
              }}>
              {FIELD_TO_LABEL[f]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export function LogsTable({
  logs,
  loading = false,
  total = 0,
  currentPage = 1,
  totalPages = 1,
  onNextPage,
  onPrevPage,
  selectedFields: externalSelectedFields,
  onSelectedFieldsChange,
  isLive = false,
}: LogsTableProps) {
  const [internalSelectedFields, setInternalSelectedFields] = useState<FieldName[]>(DEFAULT_FIELDS);
  const selectedFields = externalSelectedFields ?? internalSelectedFields;
  const setSelectedFields = onSelectedFieldsChange ?? setInternalSelectedFields;

  const availableFields = ALL_FIELDS.filter((f) => !selectedFields.includes(f));

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderTimestamp = (log: Log) => {
    const { date, time } = formatTimestamp(log.timestamp);
    return (
      <td className="table-cell" style={{ whiteSpace: "nowrap" }}>
        <span className="text-xs sm:text-sm" style={{ color: "var(--color-on-surface)" }}>
          {date},
          <br />
          <span
            className="text-xs"
            style={{
              color: "var(--color-on-surface-variant)",
              fontFamily: "monospace",
            }}>
            {time}
          </span>
        </span>
      </td>
    );
  };

  const renderMessage = (log: Log) => (
    <td className="table-cell" style={{ maxWidth: 0 }}>
      <span
        className="text-xs sm:text-sm"
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: log.level.toUpperCase() === "ERROR" ? "var(--color-error)" : "var(--color-on-surface)",
          fontWeight: log.level.toUpperCase() === "ERROR" ? 500 : 400,
        }}>
        {log.message}
      </span>
    </td>
  );

  const renderMethod = (log: Log) => (
    <td className="table-cell">
      <MethodBadge method={log.method} />
    </td>
  );

  const renderStatus = (log: Log) => (
    <td className="table-cell">
      <StatusCode code={log.status_code} />
    </td>
  );

  const renderLatency = (log: Log) => (
    <td className="table-cell">
      <span className="text-xs sm:text-sm" style={{ fontFamily: "monospace" }}>
        {log.response_time}ms
      </span>
    </td>
  );

  const renderId = (log: Log) => (
    <td className="table-cell" style={{ textAlign: "right" }}>
      <span
        className="text-xs"
        style={{
          fontFamily: "monospace",
          color: "var(--color-on-surface-variant)",
        }}>
        req-{log.id}
      </span>
    </td>
  );

  return (
    <div
      className="card mx-3 sm:mx-6 mt-3 mb-6 p-0 overflow-hidden"
      style={{ display: "flex", flexDirection: "column" }}>
      <div className="flex flex-col sm:flex-row" style={{ flex: 1, minHeight: 0 }}>
        {/* ── Field sidebar ─────────────────────────── */}
        <div className="hidden sm:block" style={{ padding: "0 0 1rem 1.25rem" }}>
          <FieldSidebar
            selectedFields={selectedFields}
            onFieldsChange={setSelectedFields}
            availableFields={availableFields}
          />
        </div>

        {/* ── Table ─────────────────────────────────── */}
        <div style={{ flex: 1, overflowX: "auto", minWidth: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr className="table-header-row">
                {/* expand toggle col */}
                <th style={{ width: 36 }} />
                {selectedFields.includes("@timestamp") && (
                  <th className="table-header-cell" style={{ textAlign: "left" }}>
                    Timestamp
                  </th>
                )}
                {selectedFields.includes("level") && (
                  <th className="table-header-cell" style={{ textAlign: "left" }}>
                    Level
                  </th>
                )}
                {selectedFields.includes("http.method") && (
                  <th className="table-header-cell" style={{ textAlign: "left" }}>
                    Method
                  </th>
                )}
                {selectedFields.includes("http.status") && (
                  <th className="table-header-cell" style={{ textAlign: "left" }}>
                    Status
                  </th>
                )}
                {selectedFields.includes("message") && (
                  <th
                    className="table-header-cell"
                    style={{ textAlign: "left", width: "40%" }}>
                    Message
                  </th>
                )}
                {selectedFields.includes("latency_ms") && (
                  <th className="table-header-cell" style={{ textAlign: "left" }}>
                    Latency
                  </th>
                )}
                {selectedFields.includes("request_id") && (
                  <th className="table-header-cell" style={{ textAlign: "right" }}>
                    ID
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={selectedFields.length + 1}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        padding: "3rem",
                        color: "var(--color-on-surface-variant)",
                        fontSize: "0.875rem",
                        gap: "0.5rem",
                      }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid var(--color-primary)",
                          borderTopColor: "transparent",
                          animation: "spin 0.7s linear infinite",
                        }}
                      />
                      Loading logs...
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={selectedFields.length + 1}>
                    <div
                      style={{
                        textAlign: "center",
                        padding: "3rem",
                        color: "var(--color-on-surface-variant)",
                        fontSize: "0.875rem",
                      }}>
                      No logs found matching the current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => {
                  const isExpanded = expandedIds.has(log.id);
                  const isAlt = i % 2 !== 0;

                  return (
                    <Fragment key={log.id}>
                      <tr
                        className={isAlt ? "table-row-alt" : ""}
                        style={{
                          cursor: "pointer",
                          borderLeft: isExpanded
                            ? "2px solid var(--color-primary)"
                            : "2px solid transparent",
                          transition: "background 0.1s",
                        }}
                        onClick={() => toggleExpand(log.id)}
                        onMouseEnter={(e) => {
                          (
                            e.currentTarget as HTMLTableRowElement
                          ).style.background =
                            "var(--color-surface-container-high)";
                        }}
                        onMouseLeave={(e) => {
                          (
                            e.currentTarget as HTMLTableRowElement
                          ).style.background = isAlt
                            ? "var(--color-surface-container-low)"
                            : "";
                        }}>
                        {/* Expand chevron */}
                        <td
                          style={{
                            width: 36,
                            paddingLeft: 10,
                            paddingRight: 0,
                          }}>
                          <span
                            style={{
                              color: "var(--color-on-surface-variant)",
                              display: "flex",
                              alignItems: "center",
                              transition: "transform 0.15s",
                            }}>
                            {isExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </span>
                        </td>

                        {/* Conditionally rendered columns */}
                        {selectedFields.includes("@timestamp") && renderTimestamp(log)}
                        {selectedFields.includes("level") && (
                          <td className="table-cell">
                            <LevelBadge level={log.level} />
                          </td>
                        )}
                        {selectedFields.includes("http.method") && renderMethod(log)}
                        {selectedFields.includes("http.status") && renderStatus(log)}
                        {selectedFields.includes("message") && renderMessage(log)}
                        {selectedFields.includes("latency_ms") && renderLatency(log)}
                        {selectedFields.includes("request_id") && renderId(log)}
                      </tr>

                      {isExpanded && (
                        <ExpandedRow log={log} />
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer / Pagination ───────────────────────── */}
      <div
        className="flex flex-col sm:flex-row items-center justify-between gap-2 p-3 sm:p-4"
        style={{
          borderTop: "1px solid rgba(195,198,214,0.15)",
          background: "var(--color-surface-container-low)",
        }}>
        {/* Left: total + live */}
        <div className="flex items-center gap-2 sm:gap-4">
          <span
            className="text-xs sm:text-sm"
            style={{ color: "var(--color-on-surface-variant)" }}>
            {Math.min((currentPage - 1) * 50 + 1, total)}–
            {Math.min(currentPage * 50, total)} of{" "}
            <strong style={{ color: "var(--color-on-surface)" }}>
              {total.toLocaleString()}
            </strong>
          </span>
          <div className="hidden sm:flex items-center gap-1.5">
            {isLive ? (
              <>
                <span className="pulse" />
                <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                  Live
                </span>
              </>
            ) : (
              <>
                <span
                  className="text-xs"
                  style={{
                    color: "var(--color-on-surface-variant)",
                    opacity: 0.5,
                  }}>
                  Disconnected
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: pagination */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            className="btn-icon"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            style={{ opacity: currentPage <= 1 ? 0.35 : 1 }}>
            <ChevronLeft size={16} />
          </button>

          <span className="text-xs sm:text-sm" style={{ color: "var(--color-on-surface-variant)" }}>
            <strong style={{ color: "var(--color-on-surface)" }}>
              {currentPage}
            </strong>
            /{totalPages}
          </span>

          <button
            className="btn-icon"
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
            style={{ opacity: currentPage >= totalPages ? 0.35 : 1 }}>
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
