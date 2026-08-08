import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { insertRow, nextNumber, useList } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — VYBE Business System" },
      { name: "description", content: "Track every project, its stage, owner and due date." },
    ],
  }),
  component: ProjectsPage,
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
};

const STATUSES = [
  "planned",
  "in_progress",
  "waiting_client",
  "review",
  "delivered",
  "closed",
  "cancelled",
];

function ProjectsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useList<Project>("projects", {
    order: { column: "created_at", ascending: false },
  });
  const customers = useList<{ id: string; name: string }>("customers", {
    order: { column: "name", ascending: true },
  });
  const packages = useList<{ id: string; name: string }>("packages", {
    order: { column: "name", ascending: true },
  });
  const templates = useList<{ id: string; name: string }>("workflow_templates", {
    order: { column: "name", ascending: true },
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const customerName = (id: string) =>
    (customers.data ?? []).find((c) => c.id === id)?.name ?? "—";

  const fields: Field[] = [
    { name: "title", label: "Project title", required: true },
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      required: true,
      options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "package_id",
      label: "Package",
      type: "select",
      options: (packages.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    },
    {
      name: "workflow_template_id",
      label: "Workflow template",
      type: "select",
      options: (templates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: STATUSES.map((s) => ({ value: s, label: humanize(s) })),
    },
    { name: "start_date", label: "Start date", type: "date" },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "agreed_total", label: "Agreed total (LKR)", type: "money" },
    { name: "description", label: "Description", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Delivery pipeline with tasks generated from workflow templates."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New project
          </Button>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="tabular">
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="font-medium hover:underline"
                  >
                    {p.code}
                  </Link>
                </TableCell>
                <TableCell>{p.title}</TableCell>
                <TableCell>{customerName(p.customer_id)}</TableCell>
                <TableCell>{formatDate(p.start_date)}</TableCell>
                <TableCell>{formatDate(p.due_date)}</TableCell>
                <TableCell>
                  <StatusBadge value={p.status} />
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(p.agreed_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(data ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No projects yet" description="Create one or convert a quotation." />
          </div>
        ) : null}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="New project"
        description="Tasks are created automatically from the selected workflow template."
        fields={fields}
        initial={{ status: "planned", start_date: new Date().toISOString().slice(0, 10) }}
        saving={saving}
        onSubmit={async (values) => {
          setSaving(true);
          try {
            const code = await nextNumber("project");
            const project = await insertRow<{ id: string }>("projects", { ...values, code });
            const templateId = values["workflow_template_id"] as string | undefined;
            if (templateId) {
              const stages = await import("@/lib/api").then((m) =>
                m.selectAll<{ name: string; position: number }>("workflow_stages", {
                  eq: { template_id: templateId },
                  order: { column: "position", ascending: true },
                }),
              );
              for (const s of stages) {
                await insertRow("project_tasks", {
                  project_id: project.id,
                  name: s.name,
                  position: s.position,
                  status: "todo",
                });
              }
            }
            setOpen(false);
            toast.success(`Project ${code} created.`);
            navigate({ to: "/projects/$id", params: { id: project.id } });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create project");
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
