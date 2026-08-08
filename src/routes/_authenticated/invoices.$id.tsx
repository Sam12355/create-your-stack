import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRow, insertRow, logActivity, updateRow, useList, useOne } from "@/lib/api";
import { formatDate, formatMoney, splitAdvance } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { LineItems } from "@/components/line-items";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatCard, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Invoice — VYBE Business System" },
      { name: "description", content: "Invoice detail with line items, payments and balance." },
    ],
  }),
  component: InvoiceDetail;
});

type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  status: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  paid_total: number;
  balance: number;
  notes: string | null;
  locked: boolean;
  milestone_label: string | null;
};
type Payment = {
  id: string;
  amount: number;
  method: string;
  paid_on: string;
  reference: string | null;
};

const STATUSES = ["draft", "sent", "partially_paid", "paid", "overdue", "void"];
const METHODS = ["cash", "bank_transfer", "card", "cheque", "online", "other"];

function InvoiceDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const invoice = useOne<Invoice>("invoices", id);
  const payments = useList<Payment>("payments", {
    eq: { invoice_id: id },
    order: { column: "paid_on", ascending: false },
  });
  const customers = useList<{ id: string; name: string }>("customers");
  const [payOpen, setPayOpen] = useState(false);

  if (invoice.isLoading) return <Loading />;
  if (invoice.error) return <ErrorNote error={invoice.error} />;
  if (!invoice.data) return <ErrorNote error={new Error("Invoice not found")} />;

  const inv = invoice.data;
  const customer = (customers.data ?? []).find((c) => c.id === inv.customer_id);
  const advance = splitAdvance(inv.grand_total, 50);

  const setStatus = async (status: string) => {
    await updateRow("invoices", inv.id, {
      status,
      ...(status === "sent" ? { issued_at: new Date().toISOString() } : {}),
    });
    await logActivity("invoice", inv.id, `status → ${status}`);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const paymentFields: Field[] = [
    { name: "amount", label: "Amount (LKR)", type: "money", required: true },
    {
      name: "method",
      label: "Method",
      type: "select",
      required: true,
      options: METHODS.map((m) => ({ value: m, label: humanize(m) })),
    },
    { name: "paid_on", label: "Paid on", type: "date", required: true },
    { name: "reference", label: "Reference / receipt no." },
    { name: "proof_url", label: "Proof link" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/invoices">
          <ArrowLeft className="mr-1 h-4 w-4" /> All invoices
        </Link>
      </Button>

      <PageHeader
        title={inv.number}
        description={`${customer?.name ?? "No customer"} · issued ${formatDate(inv.issue_date)}${
          inv.milestone_label ? ` · ${inv.milestone_label}` : ""
        }`}
        actions={
          <>
            <Select value={inv.status} onValueChange={(v) => void setStatus(v)}>
              <SelectTrigger className="w-40" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
            <Button onClick={() => setPayOpen(true)}>Record payment</Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Grand total" value={formatMoney(inv.grand_total)} tone="primary" />
        <StatCard label="Paid" value={formatMoney(inv.paid_total)} tone="success" />
        <StatCard label="Balance" value={formatMoney(inv.balance)} tone="warning" />
        <StatCard
          label="Due"
          value={formatDate(inv.due_date)}
          hint={`50% advance = ${formatMoney(advance.advance)}`}
          tone="info"
        />
      </div>

      <LineItems
        table="invoice_items"
        parentTable="invoices"
        parentKey="invoice_id"
        parentId={inv.id}
        locked={inv.locked || inv.status === "void"}
      />

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(payments.data ?? []).length === 0 ? (
            <EmptyState title="No payments yet" description="Record the first payment received." />
          ) : (
            (payments.data ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                  <StatusBadge value={p.method} />
                  {p.reference ? (
                    <span className="text-xs text-muted-foreground">{p.reference}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{formatDate(p.paid_on)}</span>
                  <button
                    aria-label="Delete payment"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!confirm("Delete this payment?")) return;
                      await deleteRow("payments", p.id);
                      qc.invalidateQueries({ queryKey: ["payments"] });
                      qc.invalidateQueries({ queryKey: ["invoices"] });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <RecordDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Record payment"
        description="The invoice balance and status update automatically."
        fields={paymentFields}
        initial={{
          amount: inv.balance,
          method: "bank_transfer",
          paid_on: new Date().toISOString().slice(0, 10),
        }}
        onSubmit={async (values) => {
          await insertRow("payments", {
            ...values,
            invoice_id: inv.id,
            customer_id: inv.customer_id,
          });
          qc.invalidateQueries({ queryKey: ["payments"] });
          qc.invalidateQueries({ queryKey: ["invoices"] });
          setPayOpen(false);
          toast.success("Payment recorded.");
        }}
      />
    </div>
  );
}
