import type { ReactNode } from "react";
import type { TooltipContentProps, TooltipValueType } from "recharts";
import styles from "@/components/chart-tooltip.module.scss";

type ChartTooltipProps = TooltipContentProps & {
  formatLabel: (label: string | number | undefined) => ReactNode;
  formatValue?: (
    value: TooltipValueType | undefined,
    name: string,
    dataKey: string,
  ) => ReactNode;
};

function defaultValue(value: TooltipValueType | undefined): ReactNode {
  if (Array.isArray(value)) return value.join(" – ");
  return value ?? "-";
}

export function ChartTooltip({
  active,
  label,
  payload,
  formatLabel,
  formatValue = defaultValue,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <section className={styles.tooltip} aria-label="Chart values">
      <p className={styles.label}>{formatLabel(label)}</p>
      <ul className={styles.values}>
        {payload.map((entry) => {
          const name = String(entry.name ?? entry.dataKey ?? "Value");
          const dataKey = String(entry.dataKey ?? "");
          return (
            <li className={styles.value} key={`${dataKey}:${name}`}>
              <span
                className={styles.swatch}
                style={{ backgroundColor: entry.color ?? entry.fill }}
                aria-hidden="true"
              />
              <span className={styles.name}>{name}</span>
              <strong>{formatValue(entry.value, name, dataKey)}</strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
