"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle, Timer } from "lucide-react";

const navItems = [
  { name: "System Metrics", href: "/metrics" },
  { name: "Logs", href: "/logs" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header
      className="surface-low"
      style={{
        height: 56,
        borderBottom: "1px solid rgba(195,198,214,0.15)",
      }}>
      <div className="flex flex-col justify-between md:flex-row md:items-center px-4 gap ">
       
       <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
         {/* ── Brand ───────────────────────────────────── */}
        <Link
          href="/"
          className="shrink-0 mt-[5px] pt-[10px] ml-[10px] font-semibold text-lg items-center "
          style={{ color: "var(--color-primary)", letterSpacing: "-0.01em" }}>
          Campus Analytics
        </Link>

        {/* ── Nav links ───────────────────────────────── */}
        <nav className="flex mt-[-0.875rem] md:mt-[0.875rem] items-center gap-1">
          {navItems.map(({ name, href }) => {
            const active = pathname === href || pathname.startsWith(href + "/");

            return (
              <Link
                key={href}
                href={href}
                className="relative flex items-center px-3 py-1 text-sm font-medium transition-colors duration-150"
                style={{
                  color: active
                    ? "var(--color-primary)"
                    : "var(--color-on-surface-variant)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontSize: "0.75rem",
                }}>
                {name}

                {/* Active underline — primary bar at bottom */}
                {active && (
                  <span
                    className="absolute bottom-0 left-3 right-3"
                    style={{
                      height: 2,
                      borderRadius: 9999,
                      background: "var(--color-primary)",
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
       </div>

        {/* ── Spacer ──────────────────────────────────── */}
        {/* <div className="flex-1" /> */}

        {/* ── Right side ──────────────────────────────── */}
        <div className="flex flex-wrap gap-4 justify-between z-0 ml-[10px] mt-[10px] items-center">
          {/* Health status */}
          <div className="flex items-center gap-1.5">
            <CheckCircle
              size={16}
              strokeWidth={2.5}
              style={{ color: "var(--color-success)" }}
            />
            <span
              className="text-xs md:text-sm font-medium "
              style={{ color: "var(--color-on-surface)" }}>
              Healthy
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 16,
              background: "rgba(195,198,214,0.3)",
            }}
          />

          {/* Uptime */}
          <div className="flex items-center gap-1.5">
            <Timer
              size={15}
              strokeWidth={2}
              style={{ color: "var(--color-on-surface-variant)" }}
            />
            <span
              className="text-xs md:text-sm"
              style={{ color: "var(--color-on-surface-variant)" }}>
              Uptime:{" "}
              <span
                className="font-medium"
                style={{ color: "var(--color-on-surface)" }}>
                99.9%
              </span>
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 16,
              background: "rgba(195,198,214,0.3)",
            }}
          />

          {/* Avatar */}
          <button
            className="flex items-center justify-center rounded-full overflow-hidden transition-opacity hover:opacity-80"
            style={{
              width: 32,
              height: 32,
              background: "var(--color-surface-container-high)",
              border: "none",
              cursor: "pointer",
            }}
            aria-label="User profile">
            {/* Placeholder avatar — swap with <Image> when you have a real src */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "var(--color-on-surface-variant)" }}>
              <circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.7" />
              <path
                d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
                opacity="0.7"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
