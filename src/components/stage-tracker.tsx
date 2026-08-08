import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, FileCheck2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useList } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/money";
import {
  saveStage,
  STAGE_STATUSES,
  STAGE_STATUS_LABEL,
  type ProjectStage,
  type StageStatus,
} from "@/lib/workflow";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Profile = { id: string; full_name: string | null; email: string | null };
type History = {
  id: string;
  stage_id: string | null;
  to_stage: string | null;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  changed_at: string;
};

export function stageTone(status: StageStatus) {
  if (status === "completed") return "border-success/40 bg-success/5";
  if (status === "waiting_client") return "border-warning/40 bg-warning/5";
  if (status === "on_hold") return "border-destructive/30 bg-destructive/5";
  if (status === "in_progress" || status === "scheduled") return "border-info/40 bg-info/5";
  return "border-border";
}

export function StageTracker({
  projectId,
  projectTitle,
  customerId,
  compact,
}: {
  projectId: string;
  projectTitle: string;
  customerId?: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const stages = useList<ProjectStage>("project_stages", {
    eq: { project_id: projectId },
    order: { column: "position", ascending: true },
  });
  const history = useList<History>("project_stage_history", {
    eq: { project_id: projectId },
    order: { column: "changed_at", ascending: false },
    limit: 25,
  });
  const profiles = useList<Profile>("profiles", { order: { column: "full_name", ascending: true } });
  const [editing, setEditing] = useState<ProjectStage | null>(null);

  const list = stages.data ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project_stages"] });
    qc.invalidateQueries({ queryKey: ["project_stage_history"] });
    qc.invalidateQueries({ queryKey: ["calendar_events"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const setStatus = async (stage: ProjectStage, status: StageStatus) => {
    try {
      await saveStage(stage, { status }, { projectTitle, customerId: customerId ?? null });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the stage");
    }
  };

  const fields: Field[] = [
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: STAGE_STATUSES.map((s) => ({ value: s, label: STAGE_STATUS_LABEL[s] })),
    },
    {
      name: "assignee_id",
      label: "Responsible",
      type: "select",
      options: (profiles.data ?? []).map((p) => ({
        value: p.id,
        label: p.full_name || p.email || p.id.slice(0, 8),
      })),
    },
    { name: "scheduled_at", label: "Scheduled date & time", type: "datetime", help: "Syncs to the calendar." },
    { name: "due_date", label: "Target date", type: "date" },
    { name: "next_action", label: "Next action", full: true },
    { name: "waiting_reason", label: "Waiting reason" },
    { name: "last_contact_date", label: "Last contact", type: "date" },
    { name: "follow_up_date", label: "Follow-up on", type: "date" },
    { name: "evidence_url", label: "Evidence / file link", full: true },
    { name: "notes", label: "Stage notes", type: "textarea" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workflow stages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {list.length === 0 ? (
            <EmptyState
              title="No workflow applied"
              description="Pick a workflow template on the project to generate its stages."
            />
          ) : (
            list.map((s, i) => (
              <div
                key={s.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
                  stageTone(s.status),
                )}
              >
                <span className="w-5 text-xs tabular text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {s.next_action ? <span>→ {s.next_action}</span> : null}
                    {s.scheduled_at ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {formatDateTime(s.scheduled_at)}
                      </span>
                    ) : null}
                    {s.due_date ? <span>due {formatDate(s.due_date)}</span> : null}
                    {s.waiting_reason ? <span>waiting: {s.waiting_reason}</span> : null}
                    {s.requires_payment ? (
                      <span className="inline-flex items-center gap-1">
                        <Wallet className="h-3 w-3" /> payment
                      </span>
                    ) : null}
                    {s.requires_file ? (
                      <span className="inline-flex items-center gap-1">
                        <FileCheck2 className="h-3 w-3" /> file
                      </span>
                    ) : null}
                    {s.requires_approval ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> approval
                      </span>
                    ) : null}
                  </p>
                </div>
                <Select value={s.status} onValueChange={(v) => void setStatus(s, v as StageStatus)}>
                  <SelectTrigger className="h-8 w-40" aria-label={`${s.name} status`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {STAGE_STATUS_LABEL[st]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  Details
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {compact ? null : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stage history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(history.data ?? []).length === 0 ? (
              <EmptyState title="No stage changes yet" />
            ) : (
              (history.data ?? []).map((h) => (
                <div key={h.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{h.to_stage ?? "Stage"}</span>
                    <span className="flex items-center gap-2">
                      {h.from_status ? <StatusBadge value={h.from_status} /> : null}
                      <span className="text-muted-foreground">→</span>
                      <StatusBadge value={h.to_status} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(h.changed_at)}
                      </span>
                    </span>
                  </div>
                  {h.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {h.notes}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <RecordDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.name ?? "Stage"}
        description="Every change is written to the stage history."
        fields={fields}
        initial={editing ?? {}}
        onSubmit={async (values) => {
          if (!editing) return;
          try {
            await saveStage(
              editing,
              {
                status: values["status"],
                assignee_id: values["assignee_id"] ?? null,
                scheduled_at: values["scheduled_at"] || null,
                due_date: values["due_date"] || null,
                next_action: values["next_action"] ?? null,
                waiting_reason: values["waiting_reason"] ?? null,
                last_contact_date: values["last_contact_date"] || null,
                follow_up_date: values["follow_up_date"] || null,
                evidence_url: values["evidence_url"] ?? null,
                notes: values["notes"] ?? null,
              },
              {
                projectTitle,
                customerId: customerId ?? null,
                ...(values["notes"] ? { historyNote: String(values["notes"]) } : {}),
              },
            );
            setEditing(null);
            refresh();
            toast.success("Stage updated.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update the stage");
          }
        }}
      />
    </div>
  );
}
