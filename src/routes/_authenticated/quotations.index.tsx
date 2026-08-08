import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { insertRow, nextNumber, useList } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/quotations/")({
  head: () => ({
    meta: [
      { title: "Quotations — VYBE Business System" },
      { name: "description", content: "Build, send and track quotations with line items." },
    ],
  }),
  component: QuotationsPage,
});

type Quotation = {
  id: string;
  number: string;
  title: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  grand_total: number;
  customer_id: string | null;
};

function QuotationsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useList<Quotation>("quotations", {
    order: { column: "created_at", ascending: false },
  });
  const customers = useList<{ id: string; name: string }>("customers", {
    order: { column: "name", ascending: true },
  });
  const leads = useList<{ id: string; name: string }>("leads", {
    order: { column: "created_at", ascending: false },
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const customerName = (id: string | null) =>
    (customers.data ?? []).find((c) => c.id === id)?.name ?? "—";

  const fields: Field[] = [
    { name: "title", label: "Quotation title", required: true },
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "lead_id",
      label: "From lead",
      type: "select",
      options: (leads.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    },
    { name: "issue_date", label: "Issue date", type: "date", required: true },
    { name: "valid_until", label: "Valid until", type: "date" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Every quotation, its status and value. Open one to edit line items."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New quotation
          </Button>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((q) => (
              <TableRow key={q.id}>
                <TableCell className="tabular">
                  <Link
                    to="/quotations/$id"
                    params={{ id: q.id }}
                    className="font-medium hover:underline"
                  >
                    {q.number}
                  </Link>
                </TableCell>
                <TableCell>{q.title || "—"}</TableCell>
                <TableCell>{customerName(q.customer_id)}</TableCell>
                <TableCell>{formatDate(q.issue_date)}</TableCell>
                <TableCell>{formatDate(q.valid_until)}</TableCell>
                <TableCell>
                  <StatusBadge value={q.status} />
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(q.grand_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(data ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No quotations yet" description="Create one to start quoting." />
          </div>
        ) : null}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="New quotation"
        description="A draft is created — add line items on the next screen."
        fields={fields}
        initial={{ issue_date: new Date().toISOString().slice(0, 10) }}
        saving={saving}
        onSubmit={async (values) => {
          setSaving(true);
          try {
            const number = await nextNumber("quotation");
            const row = await insertRow<{ id: string }>("quotations", { ...values, number });
            setOpen(false);
            toast.success(`Quotation ${number} created.`);
            navigate({ to: "/quotations/$id", params: { id: row.id } });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create quotation");
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
