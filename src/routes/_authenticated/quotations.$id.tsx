import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, FileDown, FileText, Pencil, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteRow,
  insertRow,
  logActivity,
  nextNumber,
  selectAll,
  updateRow,
  useList,
  useOne,
} from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, splitAdvance } from "@/lib/money";
import { downloadDocumentPdf, type PdfLine } from "@/lib/pdf";
import { applyTemplateToProject } from "@/lib/workflow";
import {
  advanceState,
  copyQuotation,
  createFinalInvoiceFromQuotation,
  customerSnapshot,
  findFinalInvoice,
  PAYMENT_METHODS,
  QUOTATION_STATUSES,
  quotationEditable,
  recalcQuotation,
  recordQuotationVersion,
  scopeLines,
  type PaymentRow,
  type Quotation,
} from "@/lib/documents";
import { useSession } from "@/hooks/use-session";

import { PageHeader } from "@/components/app-shell";
import { LineItems } from "@/components/line-items";
import { PresenterLines } from "@/components/presenter-lines";
import { presenterBreakdown, presenterDescription, type PresenterLine } from "@/lib/presenters";
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

export const Route = createFileRoute("/_authenticated/quotations/$id")({
  head: () => ({
    meta: [
      { title: "Quotation — VYBE Business System" },
      {
        name: "description",
        content: "Edit a quotation, record the advance and issue the final invoice.",
      },
    ],
  }),
  component: QuotationDetail,
});

type VersionRow = {
  id: string;
  version: number;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
};

function QuotationDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isOwner } = useSession();
  const { data, isLoading, error } = useOne<Quotation>("quotations", id);
  const customers = useList<{
    id: string;
    name: string;
    customer_no: string | null;
    company: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  }>("customers", { order: { column: "name", ascending: true } });
  const packages = useList<{ id: string; name: string; category: string }>("packages", {
    order: { column: "name", ascending: true },
  });
  const payments = useList<PaymentRow>("payments", {
    eq: { quotation_id: id },
    order: { column: "paid_on", ascending: false },
  });
  const versions = useList<VersionRow>("quotation_versions", {
    eq: { quotation_id: id },
    order: { column: "changed_at", ascending: false },
  });
  const profiles = useList<{ id: string; full_name: string }>("profiles");

  const [working, setWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <ErrorNote error={new Error("Quotation not found")} />;

  const q = data;
  const customer = (customers.data ?? []).find((c) => c.id === q.customer_id);
  const scope = scopeLines(q.inclusions, q.package_snapshot, q.package_description);
  const advancePercent = Number(q.advance_percent ?? 50);
  const advance = splitAdvance(q.grand_total, advancePercent);
  const advanceReceived = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const advanceStatus = advanceState(advance.advance, advanceReceived);
  const editable = quotationEditable(q.status);
  const canEditFinancials = isOwner || (user != null && q.status === "draft");
  const paymentPeople = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quotations"] });
    qc.invalidateQueries({ queryKey: ["quotation_versions"] });
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const setStatus = async (status: string) => {
    await updateRow("quotations", q.id, {
      status,
      ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      ...(status === "accepted" ? { accepted_at: new Date().toISOString(), locked: true } : {}),
      advance_percent: advancePercent,
      advance_amount: advance.advance,
      balance_amount: advance.balance,
    });
    await logActivity("quotation", q.id, `status → ${status}`);
    invalidate();
    toast.success(`Marked as ${humanize(status)}.`);
  };

  const exportPdf = async () => {
    try {
      const items = await selectAll<PdfLine>("quotation_items", { eq: { quotation_id: q.id } });
      const presenterRows = await selectAll<PresenterLine>("quotation_presenters", {
        eq: { quotation_id: q.id },
        order: { column: "position", ascending: true },
      });
      const pb = presenterBreakdown(presenterRows);
      const party =
        q.customer_snapshot ??
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
        kind: "Quotation",
        heading: "QUOTATION",
        number: q.number,
        title: q.title,
        issue_date: q.issue_date,
        secondary_label: "Valid until",
        secondary_date: q.valid_until,
        customer: party ?? undefined,
        items,
        scope,
        presenterRows: presenterRows.map((r) => [
          presenterDescription(r),
          `${r.duration} ${r.duration_unit}${Number(r.videos) > 1 ? ` × ${r.videos} videos` : ""}`,
          formatMoney(r.base_rate),
          Number(r.additional_amount) > 0 ? formatMoney(r.additional_amount) : "—",
          Number(r.travel_total) > 0
            ? `${formatMoney(r.travel_total)}${r.travel_location ? ` — ${r.travel_location}` : ""}`
            : "—",
          Number(r.other_charges) > 0 ? formatMoney(r.other_charges) : "—",
          formatMoney(r.total),
        ]),
        presenter_total: pb.performance_total + pb.other_total,
        presenter_travel_total: pb.travel_total,
        advance: { percent: advancePercent, amount: advance.advance, balance: advance.balance },
        subtotal: q.subtotal,
        discount_total: q.discount_total,
        tax_total: q.tax_total,
        grand_total: q.grand_total,
        notes: q.notes,
        bank_details: q.bank_details,
        terms: q.terms_text,
        payment_instructions: q.payment_instructions,
        payment_status: humanize(advanceStatus),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate PDF");
    }
  };

  const editFields: Field[] = [
    { name: "issue_date", label: "Quotation date", type: "date", required: true },
    { name: "valid_until", label: "Validity date", type: "date" },
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      required: true,
      options: (customers.data ?? []).map((c) => ({
        value: c.id,
        label: c.customer_no ? `${c.customer_no} — ${c.name}` : c.name,
      })),
    },
    { name: "customer_address", label: "Customer address", type: "textarea" },
    {
      name: "package_id",
      label: "Selected package",
      type: "select",
      options: (packages.data ?? []).map((p) => ({
        value: p.id,
        label: `${p.name} — ${p.category}`,
      })),
    },
    { name: "title", label: "Quotation title", full: true },
    { name: "package_description", label: "Package description", type: "textarea" },
    {
      name: "inclusions",
      label: "Package inclusions (one per line)",
      type: "list",
      placeholder: "Full-day studio session\n2 edited reels\n1 round of revisions",
    },
    { name: "advance_percent", label: "Required advance %", type: "number", required: true },
    { name: "notes", label: "Notes", type: "textarea" },
    { name: "bank_details", label: "Bank details", type: "textarea" },
    { name: "payment_instructions", label: "Payment instructions", type: "textarea" },
    { name: "terms_text", label: "Terms & conditions", type: "textarea" },
    {
      name: "amendment_reason",
      label: "Reason for editing",
      full: true,
      help: "Stored in the version history.",
    },
  ];

  const saveEdit = async (values: Values) => {
    setWorking(true);
    try {
      const nextCustomer = String(values["customer_id"] ?? q.customer_id ?? "");
      const snapshot = nextCustomer ? await customerSnapshot(nextCustomer) : null;
      const address = String(values["customer_address"] ?? "").trim();
      const next = {
        issue_date: values["issue_date"],
        valid_until: values["valid_until"] || null,
        customer_id: nextCustomer || null,
        customer_snapshot: snapshot ? { ...snapshot, address: address || snapshot.address } : null,
        package_id: values["package_id"] || null,
        title: String(values["title"] ?? ""),
        package_description: (values["package_description"] as string) || null,
        inclusions: Array.isArray(values["inclusions"]) ? values["inclusions"] : [],
        advance_percent: Number(values["advance_percent"] ?? 50),
        notes: (values["notes"] as string) || null,
        bank_details: (values["bank_details"] as string) || null,
        payment_instructions: (values["payment_instructions"] as string) || null,
        terms_text: (values["terms_text"] as string) || null,
        amendment_reason: (values["amendment_reason"] as string) || null,
      };
      const version = await recordQuotationVersion(
        q as unknown as Record<string, unknown> & { id: string },
        next,
        next.amendment_reason,
      );
      await updateRow("quotations", q.id, { ...next, version });
      await recalcQuotation(q.id, next.advance_percent);
      await logActivity("quotation", q.id, "edited", { version });
      invalidate();
      setEditOpen(false);
      toast.success("Quotation updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the quotation");
    } finally {
      setWorking(false);
    }
  };

  const openEdit = () => {
    if (!canEditFinancials) {
      toast.error("Only an owner can edit an issued quotation.");
      return;
    }
    if (!editable) {
      toast.error("This quotation is closed — create a revised version instead.");
      setReviseOpen(true);
      return;
    }
    if (q.status !== "draft") {
      const ok = confirm(
        "This quotation has already been sent to the customer. Update the existing quotation? Choose Cancel to create a revised version instead.",
      );
      if (!ok) {
        setReviseOpen(true);
        return;
      }
    }
    setEditOpen(true);
  };

  const duplicate = async (revision: boolean, reason?: string | null) => {
    setWorking(true);
    try {
      const created = await copyQuotation(q, { revision, ...(reason ? { reason } : {}) });
      invalidate();
      setReviseOpen(false);
      toast.success(`${revision ? "Revision" : "Copy"} ${created.number} created.`);
      navigate({ to: "/quotations/$id", params: { id: created.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not copy the quotation");
    } finally {
      setWorking(false);
    }
  };

  const deleteDraft = async () => {
    if (q.status !== "draft") {
      toast.error("Only a draft quotation can be deleted.");
      return;
    }
    if (!confirm(`Delete draft ${q.number}? This cannot be undone.`)) return;
    await deleteRow("quotations", q.id);
    invalidate();
    toast.success("Draft deleted.");
    navigate({ to: "/quotations" });
  };

  const convertToProject = async () => {
    if (!q.customer_id) {
      toast.error("Attach a customer before converting.");
      return;
    }
    setWorking(true);
    try {
      const code = await nextNumber("project");
      const templateId = q.package_snapshot?.workflow_template_id ?? null;
      const project = await insertRow<{ id: string }>("projects", {
        code,
        title: q.title || q.number,
        customer_id: q.customer_id,
        quotation_id: q.id,
        package_id: q.package_id,
        package_snapshot: q.package_snapshot,
        workflow_template_id: templateId,
        agreed_total: q.grand_total,
        status: "planned",
        start_date: new Date().toISOString().slice(0, 10),
      });
      if (templateId) await applyTemplateToProject(project.id, templateId);
      await updateRow("quotations", q.id, { project_id: project.id });
      await logActivity("quotation", q.id, "converted to project", { project_id: project.id });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Project ${code} created.`);
      navigate({ to: "/projects/$id", params: { id: project.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setWorking(false);
    }
  };

  const goToFinalInvoice = async () => {
    setWorking(true);
    try {
      const existing = await findFinalInvoice(q.id);
      if (existing) {
        toast.info(
          `A final invoice has already been created for this quotation (${existing.number}).`,
        );
        navigate({ to: "/invoices/$id", params: { id: existing.id } });
        return;
      }
      if (q.status !== "accepted") {
        const ok = confirm(
          "This quotation is not marked as Accepted. Create the final invoice anyway?",
        );
        if (!ok) return;
      }
      const created = await createFinalInvoiceFromQuotation(q);
      invalidate();
      // `existed` means another session won the race; the invoice was not duplicated.
      if (created.existed) {
        toast.info(
          `A final invoice has already been created for this quotation (${created.number}).`,
        );
      } else {
        toast.success(`Final invoice ${created.number} created from ${q.number}.`);
      }
      navigate({ to: "/invoices/$id", params: { id: created.id } });
    } catch (e) {
      // Raw Postgres/PostgREST text (column names, schema-cache wording) is for
      // the console, not for the person using the app.
      console.error("[final invoice] creation failed for quotation", q.number, e);
      toast.error(
        "The final invoice could not be created. Please try again or contact the administrator.",
      );
    } finally {
      setWorking(false);
    }
  };

  const paymentFields: Field[] = [
    { name: "paid_on", label: "Payment date", type: "date", required: true },
    { name: "amount", label: "Amount paid (LKR)", type: "money", required: true },
    {
      name: "method",
      label: "Payment method",
      type: "select",
      required: true,
      options: PAYMENT_METHODS.map((m) => ({ value: m, label: humanize(m) })),
    },
    { name: "reference", label: "Bank / reference number" },
    { name: "proof_url", label: "Payment proof link" },
    { name: "notes", label: "Payment note", type: "textarea" },
  ];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/quotations">
          <ArrowLeft className="mr-1 h-4 w-4" /> All quotations
        </Link>
      </Button>

      <PageHeader
        title={`${q.number}${q.title ? ` — ${q.title}` : ""}`}
        description={`${customer?.name ?? "No customer"} · issued ${formatDate(q.issue_date)} · version ${q.version ?? 1}`}
        actions={
          <>
            <Select value={q.status} onValueChange={(v) => void setStatus(v)}>
              <SelectTrigger className="w-44" aria-label="Quotation status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUOTATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={openEdit}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit quotation
            </Button>
            <Button variant="outline" onClick={() => void exportPdf()}>
              <FileDown className="mr-1.5 h-4 w-4" /> Download PDF
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Preview
            </Button>
            <Button variant="outline" disabled={working} onClick={() => void duplicate(false)}>
              <Copy className="mr-1.5 h-4 w-4" /> Duplicate
            </Button>
            <Button variant="outline" disabled={working} onClick={() => setReviseOpen(true)}>
              Create revision
            </Button>
            <Button variant="outline" onClick={() => setPayOpen(true)}>
              Record advance
            </Button>
            <Button variant="outline" disabled={working} onClick={() => void convertToProject()}>
              To project
            </Button>
            <Button disabled={working} onClick={() => void goToFinalInvoice()}>
              <FileText className="mr-1.5 h-4 w-4" />
              {q.invoice_id ? "View final invoice" : "Create final invoice"}
            </Button>
            {q.status === "draft" ? (
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
            <StatusBadge value={q.status} />
            <div>
              <StatusBadge value={advanceStatus} />
            </div>
          </CardContent>
        </Card>
        <StatCard label="Quotation total" value={formatMoney(q.grand_total)} tone="primary" />
        <StatCard
          label={`Required advance (${advancePercent}%)`}
          value={formatMoney(advance.advance)}
          tone="info"
        />
        <StatCard label="Advance received" value={formatMoney(advanceReceived)} tone="success" />
        <StatCard
          label="Remaining quoted balance"
          value={formatMoney(Number(q.grand_total) - advanceReceived)}
          hint={`Valid until ${formatDate(q.valid_until)}`}
          tone="warning"
        />
      </div>

      {scope.length > 0 ? (
        <Card className="mb-4">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">
              Package details & inclusions
              {q.package_snapshot?.name ? ` — ${q.package_snapshot.name}` : ""}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={openEdit}>
              Edit inclusions
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {scope.map((s, i) => (
                <li key={`${s}-${i}`}>{s}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Transaction snapshot — later catalogue price changes never alter this document.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <LineItems
        table="quotation_items"
        parentTable="quotations"
        parentKey="quotation_id"
        parentId={q.id}
        locked={!editable}
        onChanged={async () => {
          await recalcQuotation(q.id, advancePercent);
        }}
      />

      <PresenterLines
        table="quotation_presenters"
        parentKey="quotation_id"
        parentId={q.id}
        locked={!editable}
        onChanged={async () => {
          await recalcQuotation(q.id, advancePercent);
          invalidate();
        }}
      />

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Advance payments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>
            Record advance
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(payments.data ?? []).length === 0 ? (
            <EmptyState
              title="No advance recorded"
              description={`Required advance is ${formatMoney(advance.advance)} (${advancePercent}% of the quotation total).`}
            />
          ) : (
            (payments.data ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                  <StatusBadge value={p.method} />
                  {p.reference ? (
                    <span className="text-xs text-muted-foreground">{p.reference}</span>
                  ) : null}
                  {p.proof_url ? (
                    <a
                      href={p.proof_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline"
                    >
                      Proof
                    </a>
                  ) : null}
                  {p.created_by ? (
                    <span className="text-xs text-muted-foreground">
                      by {paymentPeople.get(p.created_by) ?? "—"}
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
                      invalidate();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))
          )}
          <dl className="grid gap-1 border-t border-border pt-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Quotation total", formatMoney(q.grand_total)],
                ...(Number(q.presenter_total) > 0
                  ? [["— including presenter charges", formatMoney(q.presenter_total)]]
                  : []),
                [`Required advance (${advancePercent}%)`, formatMoney(advance.advance)],
                ["Advance received", formatMoney(advanceReceived)],
                ["Unpaid advance", formatMoney(Math.max(0, advance.advance - advanceReceived))],
                ["Original remaining balance", formatMoney(advance.balance)],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {q.notes ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {q.notes}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(versions.data ?? []).length === 0 ? (
            <EmptyState title="No edits yet" description="Every edit is recorded here." />
          ) : (
            (versions.data ?? []).map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">v{v.version}</span>{" "}
                  <span className="text-muted-foreground">{v.reason ?? "Edited"}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {v.changed_by ? `${paymentPeople.get(v.changed_by) ?? "—"} · ` : ""}
                  {formatDateTime(v.changed_at)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${q.number}`}
        description="Totals, the advance split and the balance recalculate automatically when you save."
        fields={editFields}
        saving={working}
        initial={{
          issue_date: q.issue_date,
          valid_until: q.valid_until,
          customer_id: q.customer_id,
          customer_address: q.customer_snapshot?.address ?? customer?.address ?? "",
          package_id: q.package_id,
          title: q.title,
          package_description: q.package_description ?? q.package_snapshot?.scope ?? "",
          inclusions: q.inclusions?.length ? q.inclusions : (q.package_snapshot?.inclusions ?? []),
          advance_percent: advancePercent,
          notes: q.notes,
          bank_details: q.bank_details,
          payment_instructions: q.payment_instructions,
          terms_text: q.terms_text,
          amendment_reason: "",
        }}
        onSubmit={saveEdit}
      />

      <RecordDialog
        open={reviseOpen}
        onOpenChange={setReviseOpen}
        title="Create revised quotation"
        description="The original stays untouched in the history and is marked Revised."
        fields={[{ name: "reason", label: "Reason for the revision", full: true, required: true }]}
        saving={working}
        initial={{ reason: "" }}
        onSubmit={(values) => duplicate(true, String(values["reason"] ?? ""))}
      />

      <RecordDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Record advance payment"
        description={`Required advance is ${formatMoney(advance.advance)} — ${advancePercent}% of ${formatMoney(q.grand_total)}.`}
        fields={paymentFields}
        initial={{
          paid_on: new Date().toISOString().slice(0, 10),
          amount: Math.max(0, advance.advance - advanceReceived),
          method: "bank_transfer",
        }}
        onSubmit={async (values) => {
          try {
            await insertRow("payments", {
              ...values,
              quotation_id: q.id,
              invoice_id: q.invoice_id ?? null,
              customer_id: q.customer_id,
              kind: "advance",
              created_by: user?.id ?? null,
            });
            if (q.invoice_id) {
              const { recalcInvoice } = await import("@/lib/documents");
              await recalcInvoice(q.invoice_id);
            }
            await logActivity("quotation", q.id, "advance payment recorded", {
              amount: values["amount"],
            });
            invalidate();
            setPayOpen(false);
            toast.success("Advance payment recorded.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not record the payment");
          }
        }}
      />
    </div>
  );
}
