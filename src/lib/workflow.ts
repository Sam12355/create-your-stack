import { getSupabase } from "./supabase";
import { insertRow, selectAll, updateRow, type Row } from "./api";

export const STAGE_STATUSES = [
  "not_started",
  "in_progress",
  "waiting_client",
  "scheduled",
  "completed",
  "skipped",
  "on_hold",
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

export type TemplateStage = {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  position: number;
  is_active: boolean;
  is_optional: boolean;
  requires_approval: boolean;
  requires_payment: boolean;
  requires_file: boolean;
  creates_calendar_event: boolean;
  reminder_days_before: number | null;
  default_offset_days: number;
  depends_on_position: number | null;
  checklist: string[] | null;
};

export type ProjectStage = {
  id: string;
  project_id: string;
  template_stage_id: string | null;
  name: string;
  description: string | null;
  position: number;
  status: StageStatus;
  assignee_id: string | null;
  due_date: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  next_action: string | null;
  notes: string | null;
  waiting_reason: string | null;
  last_contact_date: string | null;
  follow_up_date: string | null;
  evidence_url: string | null;
  requires_approval: boolean;
  requires_payment: boolean;
  requires_file: boolean;
  is_optional: boolean;
};

/** Human labels for the stage board columns, in flow order. */
export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  scheduled: "Scheduled",
  waiting_client: "Waiting on client",
  on_hold: "On hold",
  completed: "Completed",
  skipped: "Skipped",
};

function eventTypeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("shoot") || n.includes("recording") || n.includes("production")) return "shoot";
  if (n.includes("booking") || n.includes("studio")) return "studio_booking";
  if (n.includes("deliver") || n.includes("launch")) return "delivery";
  if (n.includes("invoice") || n.includes("payment") || n.includes("balance")) return "payment_due";
  if (n.includes("meeting") || n.includes("review") || n.includes("onboarding")) return "meeting";
  return "other";
}

/**
 * Copy an active workflow template onto a project as live, editable stages.
 * Never overwrites stages that already exist for that project.
 */
export async function applyTemplateToProject(projectId: string, templateId: string) {
  const existing = await selectAll<ProjectStage>("project_stages", {
    eq: { project_id: projectId },
  });
  if (existing.length > 0) return existing;

  const template = await selectAll<TemplateStage>("workflow_stages", {
    eq: { template_id: templateId },
    order: { column: "position", ascending: true },
  });
  const active = template.filter((s) => s.is_active !== false);
  if (active.length === 0) return [];

  const rows = active.map((s, i) => ({
    project_id: projectId,
    template_stage_id: s.id,
    name: s.name,
    description: s.description ?? null,
    position: i,
    status: i === 0 ? "in_progress" : "not_started",
    requires_approval: Boolean(s.requires_approval),
    requires_payment: Boolean(s.requires_payment),
    requires_file: Boolean(s.requires_file),
    is_optional: Boolean(s.is_optional),
    checklist: (s.checklist ?? []).map((label) => ({ label, done: false })),
    meta: {
      creates_calendar_event: Boolean(s.creates_calendar_event),
      reminder_days_before: s.reminder_days_before ?? null,
      depends_on_position: s.depends_on_position ?? null,
    },
  }));

  const { data, error } = await getSupabase().from("project_stages").insert(rows).select();
  if (error) throw new Error(error.message);
  const created = (data ?? []) as ProjectStage[];

  await updateRow("projects", projectId, {
    workflow_template_id: templateId,
    current_stage_id: created[0]?.id ?? null,
  });
  await insertRow("project_stage_history", {
    project_id: projectId,
    stage_id: created[0]?.id ?? null,
    to_stage: created[0]?.name ?? null,
    to_status: created[0]?.status ?? null,
    notes: "Workflow applied to project",
  });
  return created;
}

/** Keep a scheduled stage mirrored on the shared calendar (one event per stage). */
export async function syncStageCalendar(stage: ProjectStage, projectTitle: string, customerId?: string | null) {
  const sb = getSupabase();
  const { data: found } = await sb
    .from("calendar_events")
    .select("id")
    .eq("stage_id", stage.id)
    .maybeSingle();

  if (!stage.scheduled_at) {
    if (found?.id) await sb.from("calendar_events").delete().eq("id", found.id);
    return;
  }

  const starts = new Date(stage.scheduled_at);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const values: Row = {
    title: `${stage.name} — ${projectTitle}`,
    event_type: eventTypeFor(stage.name),
    project_id: stage.project_id,
    customer_id: customerId ?? null,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    stage_id: stage.id,
    status: stage.status === "completed" ? "completed" : "scheduled",
  };

  if (found?.id) {
    const { error } = await sb.from("calendar_events").update(values).eq("id", found.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("calendar_events").insert(values);
    if (error) throw new Error(error.message);
  }
}

/** Update a stage, write the history entry and move the project pointer forward. */
export async function saveStage(
  stage: ProjectStage,
  patch: Row,
  context: { projectTitle: string; customerId?: string | null; historyNote?: string },
) {
  const nextStatus = (patch["status"] as StageStatus | undefined) ?? stage.status;
  const completing = nextStatus === "completed" && stage.status !== "completed";

  const updated = await updateRow<ProjectStage>("project_stages", stage.id, {
    ...patch,
    ...(completing ? { completed_at: new Date().toISOString() } : {}),
    ...(nextStatus !== "completed" ? { completed_at: null } : {}),
  });

  if (nextStatus !== stage.status || context.historyNote) {
    await insertRow("project_stage_history", {
      project_id: stage.project_id,
      stage_id: stage.id,
      from_stage: stage.name,
      to_stage: updated.name,
      from_status: stage.status,
      to_status: nextStatus,
      notes: context.historyNote ?? (patch["notes"] as string | undefined) ?? null,
      evidence_url: (patch["evidence_url"] as string | undefined) ?? null,
    });
  }

  await syncStageCalendar(updated, context.projectTitle, context.customerId);

  // Current stage = first stage that is not completed or skipped.
  const all = await selectAll<ProjectStage>("project_stages", {
    eq: { project_id: stage.project_id },
    order: { column: "position", ascending: true },
  });
  const current = all.find((s) => s.status !== "completed" && s.status !== "skipped");
  await updateRow("projects", stage.project_id, { current_stage_id: current?.id ?? null });

  return updated;
}
