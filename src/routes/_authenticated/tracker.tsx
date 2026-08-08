import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";
import { useList } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/money";
import { STAGE_STATUS_LABEL, type ProjectStage, type StageStatus } from "@/lib/workflow";
import { PageHeader } from "@/components/app-shell";
import { stageTone } from "@/components/stage-tracker";
import { EmptyState, ErrorNote, Loading, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tracker")({
  head: () => ({
    meta: [
      { title: "Workflow tracker — VYBE Business System" },
      {
        name: "description",
        content: "Live board of every active project, its current stage, status and owner.",
      },
    ],
  }),
  component: TrackerPage,
});

type Project = {
  id: string;
  code: string;
  title: string;
  customer_id: string;
  status: string;
  due_date: string | null;
  agreed_total: number;
  current_stage_id: string | null;
  work_type: string | null;
};
type Profile = { id: string; full_name: string | null; email: string | null };

const BOARD: StageStatus[] = [
  "not_started",
  "in_progress",
  "scheduled",
  "waiting_client",
  "on_hold",
  "completed",
];

const CLOSED = ["closed", "cancelled", "delivered"];

function TrackerPage() {
  const projects = useList<Project>("projects", { order: { column: "created_at", ascending: false } });
  const stages = useList<ProjectStage>("project_stages", {
    order: { column: "position", ascending: true },
  });
  const customers = useList<{ id: string; name: string }>("customers");
  const profiles = useList<Profile>("profiles");
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const stageList = stages.data ?? [];
    return (projects.data ?? [])
      .filter((p) => !CLOSED.includes(p.status))
      .map((p) => {
        const own = stageList.filter((s) => s.project_id === p.id);
        const current =
          own.find((s) => s.id === p.current_stage_id) ??
          own.find((s) => s.status !== "completed" && s.status !== "skipped") ??
          own[own.length - 1];
        const done = own.filter((s) => s.status === "completed").length;
        return { project: p, current, total: own.length, done };
      })
      .filter((r) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        const customer =
          (customers.data ?? []).find((c) => c.id === r.project.customer_id)?.name ?? "";
        return [r.project.code, r.project.title, customer, r.current?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [projects.data, stages.data, customers.data, query]);

  if (projects.isLoading || stages.isLoading) return <Loading />;
  if (projects.error) return <ErrorNote error={projects.error} />;

  const customerName = (id: string) =>
    (customers.data ?? []).find((c) => c.id === id)?.name ?? "—";
  const owner = (id: string | null | undefined) => {
    if (!id) return "Unassigned";
    const p = (profiles.data ?? []).find((x) => x.id === id);
    return p?.full_name || p?.email || "Assigned";
  };

  return (
    <div>
      <PageHeader
        title="Workflow tracker"
        description="Every active job, the stage it sits in, who owns it and what happens next."
        actions={
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            <Button
              size="sm"
              variant={view === "board" ? "secondary" : "ghost"}
              onClick={() => setView("board")}
            >
              <LayoutGrid className="mr-1.5 h-4 w-4" /> Board
            </Button>
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              onClick={() => setView("list")}
            >
              <List className="mr-1.5 h-4 w-4" /> List
            </Button>
          </div>
        }
      />

      <div className="mb-3 max-w-sm">
        <Input
          placeholder="Search project, customer or stage…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing in production" description="Active projects appear here." />
      ) : view === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BOARD.map((status) => {
            const cards = rows.filter((r) => (r.current?.status ?? "not_started") === status);
            return (
              <div key={status} className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {STAGE_STATUS_LABEL[status]}
                  <span className="tabular">{cards.length}</span>
                </p>
                <div className="space-y-2">
                  {cards.map(({ project, current, done, total }) => (
                    <Link
                      key={project.id}
                      to="/projects/$id"
                      params={{ id: project.id }}
                      className={cn(
                        "block rounded-md border bg-background p-3 text-sm shadow-none hover:bg-accent",
                        stageTone(current?.status ?? "not_started"),
                      )}
                    >
                      <p className="font-medium">{project.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {project.code} · {customerName(project.customer_id)}
                      </p>
                      <p className="mt-2 text-xs font-medium">{current?.name ?? "No stage"}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{owner(current?.assignee_id)}</span>
                        <span>
                          {done}/{total} stages
                        </span>
                        {current?.scheduled_at ? (
                          <span>{formatDateTime(current.scheduled_at)}</span>
                        ) : null}
                        {current?.due_date ? <span>due {formatDate(current.due_date)}</span> : null}
                      </p>
                      {current?.next_action ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          → {current.next_action}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                  {cards.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-muted-foreground">Empty</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Current stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project, current, done, total }) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      to="/projects/$id"
                      params={{ id: project.id }}
                      className="font-medium hover:underline"
                    >
                      {project.title}
                    </Link>
                    <p className="text-xs tabular text-muted-foreground">
                      {project.code} · {done}/{total}
                    </p>
                  </TableCell>
                  <TableCell>{customerName(project.customer_id)}</TableCell>
                  <TableCell>{current?.name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge value={current?.status ?? project.status} />
                  </TableCell>
                  <TableCell>{owner(current?.assignee_id)}</TableCell>
                  <TableCell className="max-w-56 truncate">{current?.next_action ?? "—"}</TableCell>
                  <TableCell>{formatDate(current?.due_date ?? project.due_date)}</TableCell>
                  <TableCell className="text-right tabular">
                    {formatMoney(project.agreed_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
