import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  insertRow,
  logActivity,
  nextNumber,
  selectAll,
  updateRow,
  useList,
  useOne,
} from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { downloadDocumentPdf, type PdfLine } from "@/lib/pdf";

import { PageHeader } from "@/components/app-shell";
import { LineItems } from "@/components/line-items";
import { ErrorNote, Loading, StatusBadge, humanize } from "@/components/ui-bits";
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
      { name: "description", content: "Quotation detail with line items, totals and status." },
    ],
  }),
  component: QuotationDetail,
});

type Quotation = {
  id: string;
  number: string;
  title: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  customer_id: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  locked: boolean;
};

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

function QuotationDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useOne<Quotation>("quotations", id);
  const customers = useList<{ id: string; name: string }>("customers", {
    order: { column: "name", ascending: true },
  });
  const [working, setWorking] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <ErrorNote error={new Error("Quotation not found")} />;

  const q = data;
  const customer = (customers.data ?? []).find((c) => c.id === q.customer_id);

  const setStatus = async (status: string) => {
    await updateRow("quotations", q.id, {
      status,
      ...(status === "accepted" ? { accepted_at: new Date().toISOString() } : {}),
    });
    await logActivity("quotation", q.id, `status → ${status}`);
    qc.invalidateQueries({ queryKey: ["quotations"] });
  };

  const exportPdf = async () => {
    try {
      const items = await selectAll<PdfLine>("quotation_items", { eq: { quotation_id: q.id } });
      const parties = q.customer_id
        ? await selectAll<{
            name: string;
            company: string | null;
            address: string | null;
            phone: string | null;
            email: string | null;
          }>("customers", { eq: { id: q.customer_id } })
        : [];
      await downloadDocumentPdf({
        kind: "Quotation",
        number: q.number,
        title: q.title,
        issue_date: q.issue_date,
        secondary_label: "Valid until",
        secondary_date: q.valid_until,
        customer: parties[0],
        items,
        subtotal: q.subtotal,
        discount_total: q.discount_total,
        tax_total: q.tax_total,
        grand_total: q.grand_total,
        notes: q.notes,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate PDF");
    }
  };



  const convertToProject = async () => {
    if (!q.customer_id) {
      toast.error("Attach a customer before converting.");
      return;
    }
    setWorking(true);
    try {
      const code = await nextNumber("project");
      const project = await insertRow<{ id: string }>("projects", {
        code,
        title: q.title || q.number,
        customer_id: q.customer_id,
        quotation_id: q.id,
        agreed_total: q.grand_total,
        status: "planned",
        start_date: new Date().toISOString().slice(0, 10),
      });
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

  const convertToInvoice = async () => {
    if (!q.customer_id) {
      toast.error("Attach a customer before invoicing.");
      return;
    }
    setWorking(true);
    try {
      const number = await nextNumber("invoice");
      const invoice = await insertRow<{ id: string }>("invoices", {
        number,
        customer_id: q.customer_id,
        quotation_id: q.id,
        status: "draft",
        subtotal: q.subtotal,
        discount_total: q.discount_total,
        tax_total: q.tax_total,
        grand_total: q.grand_total,
        balance: q.grand_total,
      });
      const items = await selectAll<Record<string, unknown>>("quotation_items", {
        eq: { quotation_id: q.id },
        order: { column: "position", ascending: true },
      });
      for (const it of items) {
        await insertRow("invoice_items", {
          invoice_id: invoice.id,
          package_id: it["package_id"],
          description: it["description"],
          quantity: it["quantity"],
          unit_price: it["unit_price"],
          discount: it["discount"],
          tax_rate: it["tax_rate"],
          line_total: it["line_total"],
          position: it["position"],
        });
      }
      await logActivity("quotation", q.id, "converted to invoice", { invoice_id: invoice.id });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`Invoice ${number} created.`);
      navigate({ to: "/invoices/$id", params: { id: invoice.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/quotations">
          <ArrowLeft className="mr-1 h-4 w-4" /> All quotations
        </Link>
      </Button>

      <PageHeader
        title={`${q.number}${q.title ? ` — ${q.title}` : ""}`}
        description={`${customer?.name ?? "No customer"} · issued ${formatDate(q.issue_date)}`}
        actions={
          <>
            <Select value={q.status} onValueChange={(v) => void setStatus(v)}>
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
            <Button variant="outline" disabled={working} onClick={() => void convertToProject()}>
              To project
            </Button>
            <Button disabled={working} onClick={() => void convertToInvoice()}>
              To invoice
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge value={q.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Valid until</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{formatDate(q.valid_until)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Tax</CardTitle>
          </CardHeader>
          <CardContent className="text-sm tabular">{formatMoney(q.tax_total)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Grand total</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular">
            {formatMoney(q.grand_total)}
          </CardContent>
        </Card>
      </div>

      <LineItems
        table="quotation_items"
        parentTable="quotations"
        parentKey="quotation_id"
        parentId={q.id}
        locked={q.locked}
      />

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
    </div>
  );
}
