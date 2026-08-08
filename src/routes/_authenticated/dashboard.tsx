import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  Receipt,
  TrendingUp,
  Users,
  FolderKanban,
} from "lucide-react";
import { useList } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { EmptyState, Loading, StatCard, StatusBadge } from "@/components/ui-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — VYBE Business System" },
      { name: "description", content: "Today's work, overdue items, unpaid invoices and income." },
    ],
  }),
  component: Dashboard,
});

type Lead = { id: string; name: string; stage: string; follow_up_date: string | null };
type Project = { id: string; code: string; title: string; status: string; due_date: string | null };
type Invoice = {
  id: string;
  number: string;
  status: string;
  grand_total: number;
  paid_total: number;
  balance: number;
  due_date: string | null;
  issue_date: string;
};
type Event = {
  id: string;
  title: string;
  event_type: string;
  starts_at: string;
  status: string;
};
type Task = { id: string; name: string; status: string; due_date: string | null };

function Dashboard() {
  const leads = useList<Lead>("leads", { order: { column: "created_at", ascending: false } });
  const projects = useList<Project>("projects", {
    order: { column: "due_date", ascending: true },
  });
  const invoices = useList<Invoice>("invoices", {
    order: { column: "issue_date", ascending: false },
  });
  const events = useList<Event>("calendar_events", {
    order: { column: "starts_at", ascending: true },
  });
  const tasks = useList<Task>("project_tasks", { order: { column: "due_date", ascending: true } });

  if (leads.isLoading || projects.isLoading || invoices.isLoading) return <Loading />;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const openLeads = (leads.data ?? []).filter((l) => !["won", "lost"].includes(l.stage));
  const followUps = openLeads.filter(
    (l) => l.follow_up_date && new Date(l.follow_up_date) <= today,
  );
  const activeProjects = (projects.data ?? []).filter(
    (p) => !["closed", "cancelled"].includes(p.status),
  );
  const atRisk = activeProjects.filter((p) => p.due_date && new Date(p.due_date) < today);
  const unpaid = (invoices.data ?? []).filter(
    (i) => !["paid", "void", "draft"].includes(i.status),
  );
  const outstanding = unpaid.reduce((sum, i) => sum + Number(i.balance ?? 0), 0);
  const monthIncome = (invoices.data ?? [])
    .filter((i) => new Date(i.issue_date) >= monthStart && i.status !== "void")
    .reduce((sum, i) => sum + Number(i.paid_total ?? 0), 0);
  const upcoming = (events.data ?? []).filter((e) => {
    const s = new Date(e.starts_at);
    return s >= today && s <= in7 && e.status !== "cancelled";
  });
  const openTasks = (tasks.data ?? []).filter((t) => !["done"].includes(t.status));
  const overdueTasks = openTasks.filter((t) => t.due_date && new Date(t.due_date) < today);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="What is due today, what is late, and how much money is outstanding."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Open leads"
          value={openLeads.length}
          hint={`${followUps.length} follow-ups due`}
          tone="info"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Active projects"
          value={activeProjects.length}
          hint={`${atRisk.length} overdue`}
          tone="primary"
          icon={<FolderKanban className="h-4 w-4" />}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(outstanding)}
          hint={`${unpaid.length} unpaid invoices`}
          tone="warning"
          icon={<Receipt className="h-4 w-4" />}
        />
        <StatCard
          label="Collected this month"
          value={formatMoney(monthIncome)}
          tone="success"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Next 7 days"
          value={upcoming.length}
          hint="bookings, shoots & deliveries"
          tone="info"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard
          label="Overdue tasks"
          value={overdueTasks.length}
          hint={`${openTasks.length} open in total`}
          tone="danger"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Follow-ups due</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {followUps.length === 0 ? (
              <EmptyState title="Nothing due" description="No lead follow-ups are outstanding." />
            ) : (
              followUps.slice(0, 6).map((l) => (
                <Link
                  key={l.id}
                  to="/leads"
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{l.name}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={l.stage} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(l.follow_up_date)}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Next 7 days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.length === 0 ? (
              <EmptyState title="Clear week" description="No scheduled work in the next 7 days." />
            ) : (
              upcoming.slice(0, 6).map((e) => (
                <Link
                  key={e.id}
                  to="/calendar"
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{e.title}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={e.event_type} />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(e.starts_at)}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Projects at risk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {atRisk.length === 0 ? (
              <EmptyState title="On track" description="No overdue projects." />
            ) : (
              atRisk.slice(0, 6).map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{p.title}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={p.status} />
                    <span className="text-xs text-destructive">{formatDate(p.due_date)}</span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unpaid invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unpaid.length === 0 ? (
              <EmptyState title="All settled" description="No outstanding invoices." />
            ) : (
              unpaid.slice(0, 6).map((i) => (
                <Link
                  key={i.id}
                  to="/invoices/$id"
                  params={{ id: i.id }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium tabular">{i.number}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={i.status} />
                    <span className="text-xs tabular text-muted-foreground">
                      {formatMoney(i.balance)}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
