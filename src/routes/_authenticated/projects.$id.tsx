import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteRow,
  insertRow,
  updateRow,
  useList,
  useOne,
  useSaveRow,
} from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatCard, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({
    meta: [
      { title: "Project — VYBE Business System" },
      { name: "description", content: "Project detail with tasks, schedule, files and finances." },
    ],
  }),
  component: ProjectDetail,
});

type Project = {
  id: string;
  code: string;
  title: string;
  status: string;
  customer_id: string;
  start_date: string | null;
  due_date: string | null;
  agreed_total: number;
  description: string | null;
};
type Task = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  position: number;
  due_date: string | null;
};
type Expense = { id: string; project_id: string | null; description: string; amount: number; spent_on: string };
type Invoice = { id: string; project_id: string | null; number: string; status: string; grand_total: number; balance: number };
type Event = { id: string; project_id: string | null; title: string; starts_at: string; event_type: string };
type FileRow = { id: string; project_id: string | null; label: string; url: string };

const TASK_STATUS = ["todo", "in_progress", "waiting_client", "done", "blocked"];
const PROJECT_STATUS = [
  "planned",
  "in_progress",
  "waiting_client",
  "review",
  "delivered",
  "closed",
  "cancelled",
];

function ProjectDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const project = useOne<Project>("projects", id);
  const tasks = useList<Task>("project_tasks", {
    eq: { project_id: id },
    order: { column: "position", ascending: true },
  });
  const expenses = useList<Expense>("expenses", { eq: { project_id: id } });
  const invoices = useList<Invoice>("invoices", { eq: { project_id: id } });
  const events = useList<Event>("calendar_events", {
    eq: { project_id: id },
    order: { column: "starts_at", ascending: true },
  });
  const files = useList<FileRow>("project_files", { eq: { project_id: id } });
  const customers = useList<{ id: string; name: string }>("customers");
  const saveProject = useSaveRow("projects");
  const [taskDraft, setTaskDraft] = useState("");
  const [edit, setEdit] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);

  if (project.isLoading) return <Loading />;
  if (project.error) return <ErrorNote error={project.error} />;
  if (!project.data) return <ErrorNote error={new Error("Project not found")} />;

  const p = project.data;
  const customer = (customers.data ?? []).find((c) => c.id === p.customer_id);
  const taskList = tasks.data ?? [];
  const done = taskList.filter((t) => t.status === "done").length;
  const spent = (expenses.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const invoiced = (invoices.data ?? []).reduce((s, i) => s + Number(i.grand_total), 0);
  const outstanding = (invoices.data ?? []).reduce((s, i) => s + Number(i.balance), 0);

  const fields: Field[] = [
    { name: "title", label: "Project title", required: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: PROJECT_STATUS.map((s) => ({ value: s, label: humanize(s) })),
    },
    { name: "start_date", label: "Start date", type: "date" },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "agreed_total", label: "Agreed total (LKR)", type: "money" },
    { name: "description", label: "Description", type: "textarea" },
  ];

  const addTask = async () => {
    const name = taskDraft.trim();
    if (!name) return;
    await insertRow("project_tasks", {
      project_id: id,
      name,
      position: taskList.length,
      status: "todo",
    });
    setTaskDraft("");
    qc.invalidateQueries({ queryKey: ["project_tasks"] });
  };

  const setTaskStatus = async (task: Task, status: string) => {
    await updateRow("project_tasks", task.id, {
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    });
    qc.invalidateQueries({ queryKey: ["project_tasks"] });
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/projects">
          <ArrowLeft className="mr-1 h-4 w-4" /> All projects
        </Link>
      </Button>

      <PageHeader
        title={`${p.code} — ${p.title}`}
        description={`${customer?.name ?? "No customer"} · due ${formatDate(p.due_date)}`}
        actions={
          <>
            <StatusBadge value={p.status} />
            <Button variant="outline" onClick={() => setEdit(true)}>
              Edit project
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tasks complete"
          value={`${done}/${taskList.length}`}
          tone="primary"
        />
        <StatCard label="Agreed value" value={formatMoney(p.agreed_total)} tone="info" />
        <StatCard label="Invoiced" value={formatMoney(invoiced)} hint={`${formatMoney(outstanding)} outstanding`} tone="warning" />
        <StatCard label="Costs" value={formatMoney(spent)} hint="project expenses" tone="danger" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {taskList.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="flex-1 text-sm">{t.name}</span>
                {t.due_date ? (
                  <span className="text-xs text-muted-foreground">{formatDate(t.due_date)}</span>
                ) : null}
                <Select value={t.status} onValueChange={(v) => void setTaskStatus(t, v)}>
                  <SelectTrigger className="h-8 w-36" aria-label="Task status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {humanize(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  aria-label="Delete task"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await deleteRow("project_tasks", t.id);
                    qc.invalidateQueries({ queryKey: ["project_tasks"] });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {taskList.length === 0 ? (
              <EmptyState title="No tasks" description="Add tasks or pick a workflow template." />
            ) : null}
            <form
              className="flex gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                void addTask();
              }}
            >
              <Input
                value={taskDraft}
                placeholder="Add a task…"
                onChange={(e) => setTaskDraft(e.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(events.data ?? []).length === 0 ? (
                <EmptyState title="Nothing scheduled" />
              ) : (
                (events.data ?? []).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <span>{e.title}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={e.event_type} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(e.starts_at)}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invoices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(invoices.data ?? []).length === 0 ? (
                <EmptyState title="Not invoiced yet" />
              ) : (
                (invoices.data ?? []).map((i) => (
                  <Link
                    key={i.id}
                    to="/invoices/$id"
                    params={{ id: i.id }}
                    className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="tabular font-medium">{i.number}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={i.status} />
                      <span className="tabular text-xs">{formatMoney(i.grand_total)}</span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Files & links</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setFileOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {(files.data ?? []).length === 0 ? (
                <EmptyState title="No files" description="Attach delivery or reference links." />
              ) : (
                (files.data ?? []).map((f) => (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    {f.label}
                  </a>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <RecordDialog
        open={edit}
        onOpenChange={setEdit}
        title="Edit project"
        fields={fields}
        initial={p}
        saving={saveProject.isPending}
        onSubmit={async (values) => {
          await saveProject.mutateAsync({ id: p.id, values });
          setEdit(false);
          toast.success("Project updated.");
        }}
      />

      <RecordDialog
        open={fileOpen}
        onOpenChange={setFileOpen}
        title="Add file link"
        fields={[
          { name: "label", label: "Label", required: true },
          { name: "url", label: "URL", required: true },
        ]}
        initial={{}}
        onSubmit={async (values) => {
          await insertRow("project_files", { ...values, project_id: id });
          qc.invalidateQueries({ queryKey: ["project_files"] });
          setFileOpen(false);
          toast.success("Link added.");
        }}
      />
    </div>
  );
}
