import { OPS_RANGES, type OpsRange } from "@/lib/ops-constants";
import styles from "@/features/ops.module.scss";

export function RangeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: OpsRange;
  onChange: (value: OpsRange) => void;
}) {
  return (
    <select
      className={`${styles.select} ${styles.compactSelect}`}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as OpsRange)}
    >
      {OPS_RANGES.map((range) => (
        <option key={range}>{range}</option>
      ))}
    </select>
  );
}
