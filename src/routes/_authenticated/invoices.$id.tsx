import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Pencil, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRow, insertRow, logActivity, selectAll, updateRow, useList, useOne } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { downloadDocumentPdf, type PdfLine } from "@/lib/pdf";
import {
  advanceState,
  COST_TYPES,
  customerSnapshot,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  recalcInvoice,
  reviseInvoice,
  scopeLines,
  type AdditionalCost,
  type Invoice,
  type PaymentRow,
} from "@/lib/documents";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/app-shell";
import { LineItems } from "@/components/line-items";
import { RecordDialog, type Field, type Values } from "@/components/record-dialog";
import {
  EmptyState,
  ErrorNote,
  Loading,
  StatCard,
  StatusBadge,
  humanize,
} from "@/components/ui-bits";
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
      {
        name: "description",
        content: "Final invoice with quotation details, additional costs, payments and balance.",
      },
    ],
  }),
  component: InvoiceDetail;
});

function InvoiceDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isOwner } = useSession();
  const { data, isLoading, error } = useOne<Invoice>("invoices", id);
  const customers = useList<{
    id: string;
    name: string;
    company: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  }>("customers");
  const payments = useList<PaymentRow>("payments", {
    eq: { invoice_id: id },
    order: { column: "paid_on", ascending: false },
  });
  const costs = useList<AdditionalCost>("invoice_additional_costs", {
    eq: { invoice_id: id },
    order: { column: "created_at", ascending: true },
  });
  const profiles = useList<{ id: string; full_name: string }>("profiles");

  const [editOpen, setEditOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [editCost, setEditCost] = useState<AdditionalCost | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [working, setWorking] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <ErrorNote error={new Error("Invoice not found")} />;

  const inv = data;
  const customer = (customers.data ?? []).find((c) => c.id === inv.customer_id);
  const scope = scopeLines(inv.inclusions, inv.package_snapshot, inv.package_description);
  const people = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
  const costRows = costs.data ?? [];
  const approvedCosts = costRows.filter((c) => c.approval_status === "approved");
  const paidTotal = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const locked = inv.locked || ["paid", "void"].includes(inv.status);
  const editable = !locked;

  const invalidate = async () => {
    await recalcInvoice(inv.id);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["invoice_additional_costs"] });
    qc.invalidateQueries({ queryKey: ["payments"] });
  };

  const guard = () => {
    if (editable) return true;
    toast.error("This invoice is issued and locked — create a revised invoice to change it.");
    return false;
  };

  const setStatus = async (status: string) => {
    await updateRow("invoices", inv.id, {
      status,
      ...(status === "paid" || status === "void" ? { locked: true } : {}),
    });
    await logActivity("invoice", inv.id, `status → ${status}`);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    toast.success(`Marked as ${humanize(status)}.`);
  };

  const exportPdf = async () => {
    try {
      const items = await selectAll<PdfLine>("invoice_items", { eq: { invoice_id: inv.id } });
      const party =
        inv.customer_snapshot ??
        (customer
          ? {
              name: customer.name,
              company: customer.company,
              address: customer.address,
              phone: customer.phone,
              email: customer.email,
            }
          : undefined);
      await downloadDocumentPdf({
        kind: "Invoice",
        heading: inv.doc_kind === "final" ? "FINAL INVOICE" : "INVOICE",
        number: inv.number,
        reference: inv.quotation_snapshot?.number
          ? `Ref: Quotation ${inv.quotation_snapshot.number}`
          : null,
        title: inv.milestone_label ?? "",
        issue_date: inv.issue_date,
        secondary_label: "Due",
        secondary_date: inv.due_date,
        customer: party ?? undefined,
        items,
        scope,
        additionalRows: approvedCosts.map((c) => [
          `${humanize(c.cost_type)} — ${c.description}`,
          String(c.quantity),
          formatMoney(c.unit_price),
          formatMoney(c.amount),
        ]),
        subtotal: inv.subtotal,
        discount_total: inv.discount_total,
        tax_total: inv.tax_total,
        additional_total: inv.additional_total,
        grand_total: inv.grand_total,
        paid_total: inv.paid_total,
        balance: inv.balance,
        notes: inv.notes,
        bank_details: inv.bank_details,
        terms: inv.terms_text,
        payment_instructions: inv.payment_instructions,
        payment_status: Number(inv.balance) <= 0 ? "PAID IN FULL" : humanize(inv.status),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate PDF");
    }
  };

  const editFields: Field[] = [
    { name: "issue_date", label: "Invoice date", type: "date", required: true },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "milestone_label", label: "Invoice title / milestone" },
    { name: "package_description", label: "Package description", type: "textarea" },
    { name: "inclusions", label: "Inclusions (one per line)", type: "list" },
    { name: "adjustment_total", label: "Discount / adjustment (LKR)", type: "money" },
    { name: "adjustment_note", label: "Adjustment note" },
    { name: "notes", label: "Notes", type: "textarea" },
    { name: "bank_details", label: "Bank details", type: "textarea" },
    { name: "payment_instructions", label: "Payment instructions", type: "textarea" },
    { name: "terms_text", label: "Terms & conditions", type: "textarea" },
  ];

  const saveEdit = async (values: Values) => {
    setWorking(true);
    try {
      const snapshot = inv.customer_snapshot ?? (await customerSnapshot(inv.customer_id));
      await updateRow("invoices", inv.id, {
        issue_date: values["issue_date"],
        due_date: values["due_date"] || null,
        milestone_label: (values["milestone_label"] as string) || null,
        package_description: (values["package_description"] as string) || null,
        inclusions: Array.isArray(values["inclusions"]) ? values["inclusions"] : [],
        adjustment_total: Number(values["adjustment_total"] ?? 0),
        adjustment_note: (values["adjustment_note"] as string) || null,
        notes: (values["notes"] as string) || null,
        bank_details: (values["bank_details"] as string) || null,
        payment_instructions: (values["payment_instructions"] as string) || null,
        terms_text: (values["terms_text"] as string) || null,
        customer_snapshot: snapshot,
      });
      await invalidate();
      setEditOpen(false);
      toast.success("Invoice updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the invoice");
    } finally {
      setWorking(false);
    }
  };

  const costFields: Field[] = [
    {
      name: "cost_type",
      label: "Cost type",
      type: "select",
      required: true,
      options: COST_TYPES.map((c) => ({ value: c, label: humanize(c) })),
    },
    { name: "description", label: "Description", required: true, full: true },
    { name: "quantity", label: "Quantity / hours", type: "number", required: true },
    { name: "unit_price", label: "Unit price (LKR)", type: "money", required: true },
    { name: "reason", label: "Reason / justification", full: true },
    {
      name: "approval_status",
      label: "Approval",
      type: "select",
      options: ["pending", "approved", "rejected"].map((s) => ({ value: s, label: humanize(s) })),
      help: isOwner
        ? "Only approved costs are added to the invoice total."
        : "Owner approval is required before a cost is billed.",
    },
    { name: "notes", label: "Internal note", type: "textarea" },
  ];

  const saveCost = async (values: Values) => {
    const quantity = Number(values["quantity"] ?? 1);
    const unit = Number(values["unit_price"] ?? 0);
    const payload = {
      invoice_id: inv.id,
      cost_type: values["cost_type"],
      description: values["description"],
      quantity,
      unit_price: unit,
      amount: Number((quantity * unit).toFixed(2)),
      reason: (values["reason"] as string) || null,
      notes: (values["notes"] as string) || null,
      approval_status: isOwner ? ((values["approval_status"] as string) ?? "approved") : "pending",
    };
    if (editCost) await updateRow("invoice_additional_costs", editCost.id, payload);
    else await insertRow("invoice_additional_costs", { ...payload, created_by: user?.id ?? null });
    await invalidate();
    setCostOpen(false);
    setEditCost(null);
    toast.success(editCost ? "Additional cost updated." : "Additional cost added.");
  };

  const makeRevision = async () => {
    setWorking(true);
    try {
      const created = await reviseInvoice(inv, "Revised invoice");
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`Revised invoice ${created.number} created.`);
      navigate({ to: "/invoices/$id", params: { id: created.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revise the invoice");
    } finally {
      setWorking(false);
    }
  };

  const deleteDraft = async () => {
    if (inv.status !== "draft") {
      toast.error("Only a draft invoice can be deleted.");
      return;
    }
    if (!confirm(`Delete draft ${inv.number}?`)) return;
    await deleteRow("invoices", inv.id);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    navigate({ to: "/invoices" });
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/invoices">
          <ArrowLeft className="mr-1 h-4 w-4" /> All invoices
        </Link>
      </Button>

      <PageHeader
        title={`${inv.number}${inv.doc_kind === "final" ? " — Final invoice" : ""}`}
        description={
          `${customer?.name ?? "No customer"} · issued ${formatDate(inv.issue_date)}` +
          (inv.quotation_snapshot?.number ? ` · from ${inv.quotation_snapshot.number}` : "")
        }
        actions={
          <>
            <Select value={inv.status} onValueChange={(v) => void setStatus(v)}>
              <SelectTrigger className="w-40" aria-label="Invoice status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                if (guard()) setEditOpen(true);
              }}
            >
              <Pencil className="mr-1.5 h-4 w-4" /> Edit invoice
            </Button>
            <Button variant="outline" onClick={() => void exportPdf()}>
              <FileDown className="mr-1.5 h-4 w-4" /> Download PDF
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Preview
            </Button>
            <Button variant="outline" disabled={working} onClick={() => void makeRevision()}>
              Create revision
            </Button>
            <Button onClick={() => setPayOpen(true)}>Record payment</Button>
            {inv.status === "draft" ? (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => void deleteDraft()}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete draft
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatusBadge value={inv.status} />
            <div>
              <StatusBadge value={advanceState(Number(inv.advance_expected), paidTotal)} />
            </div>
          </CardContent>
        </Card>
        <StatCard
          label="Quotation total"
          value={formatMoney(inv.quotation_total || inv.subtotal)}
          tone="info"
        />
        <StatCard
          label="Additional costs"
          value={formatMoney(inv.additional_total)}
          hint={`${approvedCosts.length} approved of ${costRows.length}`}
          tone="warning"
        />
        <StatCard label="Invoice total" value={formatMoney(inv.grand_total)} tone="primary" />
        <StatCard
          label="Balance due"
          value={formatMoney(inv.balance)}
          hint={`Paid ${formatMoney(inv.paid_total)}`}
          tone={Number(inv.balance) <= 0 ? "success" : "danger"}
        />
      </div>

      {scope.length > 0 ? (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Package details & inclusions
              {inv.package_snapshot?.name ? ` — ${inv.package_snapshot.name}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {scope.map((s, i) => (
                <li key={`${s}-${i}`}>{s}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Copied from the quotation at the moment this invoice was created.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <LineItems
        table="invoice_items"
        parentTable="invoices"
        parentKey="invoice_id"
        parentId={inv.id}
        locked={!editable}
        onChanged={async () => {
          await invalidate();
        }}
      />

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Additional costs</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!guard()) return;
              setEditCost(null);
              setCostOpen(true);
            }}
          >
            Add cost
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {costRows.length === 0 ? (
            <EmptyState
              title="No additional costs"
              description="Add overtime, extra filming, travel or any other extra before issuing the invoice."
            />
          ) : (
            costRows.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={c.approval_status} />
                  <span className="font-medium">{humanize(c.cost_type)}</span>
                  <span className="text-muted-foreground">{c.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.quantity} × {formatMoney(c.unit_price)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular font-medium">{formatMoney(c.amount)}</span>
                  <button
                    aria-label="Edit cost"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (!guard()) return;
                      setEditCost(c);
                      setCostOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    aria-label="Remove cost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!guard()) return;
                      if (!confirm("Remove this additional cost?")) return;
                      await deleteRow("invoice_additional_costs", c.id);
                      await invalidate();
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

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Payments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>
            Record payment
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(payments.data ?? []).length === 0 ? (
            <EmptyState title="No payments yet" description="Record the advance and the balance here." />
          ) : (
            (payments.data ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                  <StatusBadge value={p.kind} />
                  <StatusBadge value={p.method} />
                  {p.reference ? (
                    <span className="text-xs text-muted-foreground">{p.reference}</span>
                  ) : null}
                  {p.created_by ? (
                    <span className="text-xs text-muted-foreground">
                      by {people.get(p.created_by) ?? "—"}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{formatDate(p.paid_on)}</span>
                  <button
                    aria-label="Delete payment"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!confirm("Delete this payment record?")) return;
                      await deleteRow("payments", p.id);
                      await invalidate();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))
          )}

          <dl className="grid gap-1 border-t border-border pt-3 text-sm sm:grid-cols-2">
            {[
              ["Quotation total", formatMoney(inv.quotation_total || inv.subtotal)],
              ["Approved additional costs", formatMoney(inv.additional_total)],
              ["Adjustment / discount", `- ${formatMoney(inv.adjustment_total)}`],
              ["Invoice total", formatMoney(inv.grand_total)],
              ["Total paid (incl. advance)", `- ${formatMoney(inv.paid_total)}`],
              ["Balance due", formatMoney(inv.balance)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${inv.number}`}
        description="Totals and the balance due recalculate automatically."
        fields={editFields}
        saving={working}
        initial={{
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          milestone_label: inv.milestone_label,
          package_description: inv.package_description,
          inclusions: inv.inclusions ?? [],
          adjustment_total: inv.adjustment_total,
          adjustment_note: inv.adjustment_note,
          notes: inv.notes,
          bank_details: inv.bank_details,
          payment_instructions: inv.payment_instructions,
          terms_text: inv.terms_text,
        }}
        onSubmit={saveEdit}
      />

      <RecordDialog
        open={costOpen}
        onOpenChange={(o) => {
          setCostOpen(o);
          if (!o) setEditCost(null);
        }}
        title={editCost ? "Edit additional cost" : "Add additional cost"}
        description="Approved costs are added to the invoice total and appear on the PDF."
        fields={costFields}
        initial={{
          cost_type: editCost?.cost_type ?? "studio_overtime",
          description: editCost?.description ?? "",
          quantity: editCost?.quantity ?? 1,
          unit_price: editCost?.unit_price ?? 0,
          reason: editCost?.reason ?? "",
          approval_status: editCost?.approval_status ?? (isOwner ? "approved" : "pending"),
          notes: editCost?.notes ?? "",
        }}
        onSubmit={saveCost}
      />

      <RecordDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Record payment"
        description={`Balance due is ${formatMoney(inv.balance)}.`}
        fields={[
          { name: "paid_on", label: "Payment date", type: "date", required: true },
          { name: "amount", label: "Amount (LKR)", type: "money", required: true },
          {
            name: "kind",
            label: "Payment type",
            type: "select",
            options: ["advance", "balance", "part"].map((k) => ({ value: k, label: humanize(k) })),
          },
          {
            name: "method",
            label: "Method",
            type: "select",
            required: true,
            options: PAYMENT_METHODS.map((m) => ({ value: m, label: humanize(m) })),
          },
          { name: "reference", label: "Bank / reference number" },
          { name: "proof_url", label: "Payment proof link" },
          { name: "notes", label: "Note", type: "textarea" },
        ]}
        initial={{
          paid_on: new Date().toISOString().slice(0, 10),
          amount: Math.max(0, Number(inv.balance)),
          kind: "balance",
          method: "bank_transfer",
        }}
        onSubmit={async (values) => {
          try {
            await insertRow("payments", {
              ...values,
              invoice_id: inv.id,
              quotation_id: inv.quotation_id,
              customer_id: inv.customer_id,
              created_by: user?.id ?? null,
            });
            await invalidate();
            setPayOpen(false);
            toast.success("Payment recorded.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not record the payment");
          }
        }}
      />
    </div>
  );
}
