"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { authClient } from "@/lib/auth-client";
import styles from "@/features/ops/ops.module.scss";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) {
      setError(
        "Your Microsoft account is not enabled for Ops. Ask an Ops admin to add it.",
      );
    }
  }, []);

  async function signInWithMicrosoft() {
    setLoading(true);
    setError(null);
    const returnTo = new URLSearchParams(window.location.search).get(
      "returnTo",
    );
    const callbackURL =
      returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    const result = await authClient.signIn.social({
      provider: "microsoft",
      callbackURL,
      errorCallbackURL: "/sign-in?error=unauthorized",
    });
    if (result.error) {
      setLoading(false);
      setError(
        "Microsoft sign-in could not be started. Check the Azure configuration.",
      );
    }
  }

  return (
    <main className={`${styles.page} ${styles.signInPage}`}>
      <section
        className={`${styles.panel} ${styles.panelBody} ${styles.signInCard}`}
      >
        <div className={styles.signInTopline}>
          <p className={styles.eyebrow}>Coding Club IIT Guwahati</p>
          <ThemeToggle />
        </div>
        <h1 className={styles.heading}>Sign in to Ops</h1>
        <p className={styles.subheading}>
          Use your Microsoft account. Access is restricted to accounts granted
          an Ops viewer or admin role.
        </p>
        <div className={styles.signInFields}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            className={`${styles.button} ${styles.microsoftButton}`}
            disabled={loading}
            onClick={() => void signInWithMicrosoft()}
          >
            <span className={styles.microsoftMark} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {loading ? "Redirecting…" : "Continue with Microsoft"}
          </button>
        </div>
      </section>
    </main>
  );
}
