import { ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
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
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat-chip">
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
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric-tile">
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
