import { ChangeEvent, ReactNode } from "react";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SectionCard({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("section-card", className)}>
      <div className="section-head">
        <div>
          {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p className="section-copy">{description}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("toolbar", className)}>{children}</div>;
}

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button className={cx("icon-button", className)} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

export function StatChip({
  label,
  value,
  hint,
  tone = "neutral",
  pulse = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  pulse?: boolean;
}) {
  return (
    <div className={cx("stat-chip", `tone-${tone}`, pulse && "is-pulsing")}>
      <span className="stat-chip-label">{label}</span>
      <strong className="stat-chip-value">{value}</strong>
      {hint ? <span className="stat-chip-hint">{hint}</span> : null}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div className={cx("metric-tile", `tone-${tone}`)}>
      <span className="metric-tile-label">{label}</span>
      <strong className="metric-tile-value">{value}</strong>
      {detail ? <span className="metric-tile-detail">{detail}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state-card ${compact ? "is-compact" : ""}`}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function DataList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("data-list", className)}>{children}</div>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; hint?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      <span className="control-label">{label}</span>
      <div className="segmented-options">
        {options.map((option) => (
          <button
            key={option.value}
            className={cx("segmented-option", value === option.value && "is-active")}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
          >
            <strong>{option.label}</strong>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SliderInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="slider-input">
      <span>
        {label}
        <strong>
          {value}
          {suffix ?? ""}
        </strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function FileDropzone({
  label,
  fileName,
  accept,
  onChange,
  disabled = false,
}: {
  label: string;
  fileName: string;
  accept?: string;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx("file-dropzone", disabled && "is-disabled")}>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.files?.[0] ?? null)}
      />
      <span className="file-dropzone-kicker">{label}</span>
      <strong>{fileName || "拖入或选择参考音频"}</strong>
      <small>{fileName ? "已准备好用于 clone / ASR" : "支持 audio/*，不会改变后端接口"}</small>
    </label>
  );
}
