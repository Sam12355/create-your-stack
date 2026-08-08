import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { insertRow, nextNumber, useList } from "@/lib/api";
import { formatDate, formatMoney, splitAdvance } from "@/lib/money";
import {
  advanceState,
  createFinalInvoiceFromQuotation,
  customerSnapshot,
  findFinalInvoice,
  type PaymentRow,
  type Quotation,
} from "@/lib/documents";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatCard, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      {
        name: "description",
        content: "Quotations awaiting invoicing, final invoices, payments and balances.",
      },
    ],
  }),
  component: InvoicesPage,
});

type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  quotation_id: string | null;
  project_id: string | null;
  status: string;
  doc_kind: string;
  issue_date: string;
  due_date: string | null;
  grand_total: number;
  paid_total: number;
  balance: number;
};

function InvoicesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useList<Invoice>("invoices", {
    order: { column: "created_at", ascending: false },
  });
  const quotations = useList<Quotation>("quotations", {
    order: { column: "created_at", ascending: false },
  });
  const payments = useList<PaymentRow>("payments");
  const customers = useList<{ id: string; name: string }>("customers", {
    order: { column: "name", ascending: true },
  });
  const projects = useList<{ id: string; title: string }>("projects", {
    order: { column: "created_at", ascending: false },
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const rows = data ?? [];
  const quotes = quotations.data ?? [];
  const outstanding = rows
    .filter((i) => !["void", "paid"].includes(i.status))
    .reduce((s, i) => s + Number(i.balance), 0);
  const overdue = rows.filter((i) => i.status === "overdue");
  const collected = rows.reduce((s, i) => s + Number(i.paid_total), 0);
  const customerName = (id: string | null) =>
    (customers.data ?? []).find((c) => c.id === id)?.name ?? "—";
  const advanceFor = (quotationId: string) =>
    (payments.data ?? [])
      .filter((p) => p.quotation_id === quotationId)
      .reduce((s, p) => s + Number(p.amount), 0);

  const makeFinal = async (q: Quotation) => {
    setBusy(q.id);
    try {
      const existing = await findFinalInvoice(q.id);
      if (existing) {
        navigate({ to: "/invoices/$id", params: { id: existing.id } });
        return;
      }
      const created = await createFinalInvoiceFromQuotation(q);
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success(`Final invoice ${created.number} created from ${q.number}.`);
      navigate({ to: "/invoices/$id", params: { id: created.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the final invoice");
    } finally {
      setBusy(null);
    }
  };

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
        description="Quotations, final invoices, payment tracking and outstanding balances."
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

      <Tabs defaultValue="quotations">
        <TabsList className="mb-3">
          <TabsTrigger value="quotations">Quotations ({quotes.length})</TabsTrigger>
          <TabsTrigger value="final">Final invoices ({rows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="quotations">
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quotation</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Advance</TableHead>
                  <TableHead>Advance status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => {
                  const split = splitAdvance(q.grand_total, Number(q.advance_percent ?? 50));
                  const received = advanceFor(q.id);
                  return (
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
                      <TableCell>{customerName(q.customer_id)}</TableCell>
                      <TableCell>{formatDate(q.issue_date)}</TableCell>
                      <TableCell>
                        <StatusBadge value={q.status} />
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(q.grand_total)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(received)} / {formatMoney(split.advance)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={advanceState(split.advance, received)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/quotations/$id" params={{ id: q.id }}>
                              View / edit
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === q.id}
                            onClick={() => void makeFinal(q)}
                          >
                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                            {q.invoice_id ? "View invoice" : "Create final invoice"}
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {quotes.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No quotations yet"
                  description="Create a quotation first — final invoices are generated from it."
                />
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="final">
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>From quotation</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
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
                    <TableCell className="tabular">
                      {i.quotation_id ? (
                        <Link
                          to="/quotations/$id"
                          params={{ id: i.quotation_id }}
                          className="hover:underline"
                        >
                          {quotes.find((q) => q.id === i.quotation_id)?.number ?? "—"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{formatDate(i.issue_date)}</TableCell>
                    <TableCell>{formatDate(i.due_date)}</TableCell>
                    <TableCell>
                      <StatusBadge value={i.status} />
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(i.grand_total)}
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(i.paid_total)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(i.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No final invoices yet"
                  description="Open a quotation and choose “Create final invoice”."
                />
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

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
            const snapshot = await customerSnapshot(String(values["customer_id"] ?? ""));
            const row = await insertRow<{ id: string }>("invoices", {
              ...values,
              number,
              customer_snapshot: snapshot,
            });
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
