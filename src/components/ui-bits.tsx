import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const TONE: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-info/10 text-info border-info/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  primary: "bg-accent text-accent-foreground border-transparent",
};

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  // leads
  new_inquiry: "info",
  contacted: "info",
  requirement_collected: "primary",
  quotation_sent: "warning",
  won: "success",
  lost: "danger",
  on_hold: "neutral",
  // quotations
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
  // projects / tasks
  planned: "neutral",
  in_progress: "info",
  waiting_client: "warning",
  review: "primary",
  delivered: "success",
  closed: "neutral",
  cancelled: "danger",
  todo: "neutral",
  done: "success",
  blocked: "danger",
  // invoices
  partially_paid: "warning",
  paid: "success",
  overdue: "danger",
  void: "neutral",
  // generic
  scheduled: "info",
  completed: "success",
};

export function humanize(value?: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = STATUS_TONE[value] ?? "neutral";
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[tone])}>
      {humanize(value)}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONE;
  icon?: ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 truncate text-2xl font-semibold tabular">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
              TONE[tone],
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{label}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}
