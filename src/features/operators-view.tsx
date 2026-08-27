"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import type {
  OperatorGrantDto,
  OperatorRole,
} from "@/lib/server/operator-grants";
import styles from "@/features/ops.module.scss";

type OperatorsResponse = { data: OperatorGrantDto[] };

export function OperatorsView({ currentEmail }: { currentEmail: string }) {
  const [operators, setOperators] = useState<OperatorGrantDto[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OperatorRole>("viewer");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOperators = useCallback(async () => {
    try {
      const response = (await apiFetch("/operators")) as OperatorsResponse;
      setOperators(response.data);
      setError(null);
    } catch {
      setError("Unable to load Ops users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOperators();
  }, [loadOperators]);

  async function saveOperator(input: {
    email: string;
    role: OperatorRole;
    enabled: boolean;
  }) {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/operators", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setEmail("");
      await loadOperators();
    } catch {
      setError("Unable to save this Ops user.");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveOperator({ email, role, enabled: true });
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Access control</p>
          <h1 className={styles.heading}>Ops users</h1>
          <p className={styles.subheading}>
            Grant access to developers and infra maintainers.
          </p>
        </div>
      </div>

      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelHeader}>
          <h2>Add or update a user</h2>
        </div>
        <div className={styles.panelBody}>
          <form className={styles.operatorForm} onSubmit={handleSubmit}>
            <label className={styles.fieldLabel}>
              Microsoft email
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
            </label>
            <label className={styles.fieldLabel}>
              Ops role
              <select
                className={styles.select}
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as OperatorRole)
                }
              >
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className={styles.button} type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save user"}
            </button>
          </form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <section
        className={`${styles.panel} ${styles.panelWide} ${styles.operatorList}`}
      >
        <div className={styles.panelHeader}>
          <h2>Authorized accounts</h2>
        </div>
        {loading ? (
          <p className={styles.empty}>Loading users…</p>
        ) : operators.length === 0 ? (
          <p className={styles.empty}>No users have been added.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {operators.map((operator) => (
                  <tr key={operator.email}>
                    <td>{operator.email}</td>
                    <td className={styles.mono}>{operator.role}</td>
                    <td>
                      <StatusBadge
                        tone={operator.enabled ? "success" : "neutral"}
                      >
                        {operator.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </td>
                    <td>{new Date(operator.updatedAt).toLocaleString()}</td>
                    <td>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        disabled={saving || operator.email === currentEmail}
                        onClick={() =>
                          void saveOperator({
                            email: operator.email,
                            role: operator.role,
                            enabled: !operator.enabled,
                          })
                        }
                      >
                        {operator.enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
