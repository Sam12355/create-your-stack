import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { insertRow, nextNumber, useList } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatCard, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — VYBE Business System" },
      { name: "description", content: "Issue invoices, record payments and chase balances." },
    ],
  }),
  component: InvoicesPage,
});

type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  project_id: string | null;
  status: string;
  issue_date: string;
  due_date: string | null;
  grand_total: number;
  paid_total: number;
  balance: number;
};

function InvoicesPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useList<Invoice>("invoices", {
    order: { column: "created_at", ascending: false },
  });
  const customers = useList<{ id: string; name: string }>("customers", {
    order: { column: "name", ascending: true },
  });
  const projects = useList<{ id: string; title: string }>("projects", {
    order: { column: "created_at", ascending: false },
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const rows = data ?? [];
  const outstanding = rows
    .filter((i) => !["void", "paid"].includes(i.status))
    .reduce((s, i) => s + Number(i.balance), 0);
  const overdue = rows.filter((i) => i.status === "overdue");
  const collected = rows.reduce((s, i) => s + Number(i.paid_total), 0);
  const customerName = (id: string) => (customers.data ?? []).find((c) => c.id === id)?.name ?? "—";

  const fields: Field[] = [
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      required: true,
      options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "project_id",
      label: "Project",
      type: "select",
      options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.title })),
    },
    { name: "issue_date", label: "Issue date", type: "date", required: true },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "milestone_label", label: "Milestone label", placeholder: "50% advance" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Billing, payment tracking and outstanding balances."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New invoice
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Outstanding" value={formatMoney(outstanding)} tone="warning" />
        <StatCard label="Overdue invoices" value={overdue.length} tone="danger" />
        <StatCard label="Collected to date" value={formatMoney(collected)} tone="success" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="tabular">
                  <Link
                    to="/invoices/$id"
                    params={{ id: i.id }}
                    className="font-medium hover:underline"
                  >
                    {i.number}
                  </Link>
                </TableCell>
                <TableCell>{customerName(i.customer_id)}</TableCell>
                <TableCell>{formatDate(i.issue_date)}</TableCell>
                <TableCell>{formatDate(i.due_date)}</TableCell>
                <TableCell>
                  <StatusBadge value={i.status} />
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(i.grand_total)}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(i.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No invoices yet" description="Create one or convert a quotation." />
          </div>
        ) : null}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="New invoice"
        description="A draft invoice is created — add line items next."
        fields={fields}
        initial={{ issue_date: new Date().toISOString().slice(0, 10) }}
        saving={saving}
        onSubmit={async (values) => {
          setSaving(true);
          try {
            const number = await nextNumber("invoice");
            const row = await insertRow<{ id: string }>("invoices", { ...values, number });
            setOpen(false);
            toast.success(`Invoice ${number} created.`);
            navigate({ to: "/invoices/$id", params: { id: row.id } });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create invoice");
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
