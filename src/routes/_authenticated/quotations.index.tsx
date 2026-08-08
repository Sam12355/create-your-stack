import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { insertRow, nextNumber, useList } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import {
  createQuotationFromPackage,
  introDiscountUsed,
  packageOptions,
  type PackageRow,
} from "@/lib/quote";
import { useSession } from "@/hooks/use-session";
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

type Customer = {
  id: string;
  name: string;
  customer_no: string | null;
  package_id: string | null;
};


function QuotationsPage() {
  const navigate = useNavigate();
  const { user, isOwner } = useSession();
  const { data, isLoading, error } = useList<Quotation>("quotations", {
    order: { column: "created_at", ascending: false },
  });
  const customers = useList<Customer>("customers", {
    order: { column: "name", ascending: true },
  });
  const packages = useList<PackageRow>("packages", {
    order: { column: "category", ascending: true },
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
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      required: true,
      options: (customers.data ?? []).map((c) => ({
        value: c.id,
        label: c.customer_no ? `${c.customer_no} — ${c.name}` : c.name,
      })),
      help: "Leave the package blank to reuse the package saved on the customer.",
    },
    {
      name: "package_id",
      label: "Package / service",
      type: "select",
      full: true,
      options: packageOptions(packages.data ?? []),
    },
    { name: "title", label: "Quotation title", placeholder: "Defaults to the package name" },
    {
      name: "lead_id",
      label: "From lead",
      type: "select",
      options: (leads.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    },
    { name: "issue_date", label: "Issue date", type: "date", required: true },
    { name: "valid_until", label: "Valid until", type: "date" },
    { name: "advance_percent", label: "Advance %", type: "number", required: true },
    {
      name: "apply_intro_discount",
      label: "Apply introductory discount",
      type: "switch",
      help: isOwner
        ? "First-time customers only. Website packages are never eligible."
        : "Owner approval is required — ask an owner to apply the discount.",
    },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  const createQuotation = async (values: Record<string, unknown>) => {
    const customerId = String(values["customer_id"] ?? "");
    const customer = (customers.data ?? []).find((c) => c.id === customerId);
    const pkgId = (values["package_id"] as string | null) || customer?.package_id || null;
    const pkg = (packages.data ?? []).find((p) => p.id === pkgId);

    if (!pkg) {
      // No package anywhere: fall back to an empty draft the user fills by hand.
      const number = await nextNumber("quotation");
      const row = await insertRow<{ id: string }>("quotations", {
        number,
        customer_id: customerId,
        lead_id: values["lead_id"] ?? null,
        title: values["title"] ?? "",
        issue_date: values["issue_date"],
        valid_until: values["valid_until"] || null,
        notes: values["notes"] ?? null,
        advance_percent: Number(values["advance_percent"] ?? 50),
        status: "draft",
      });
      return { id: row.id, number };
    }

    let applyIntro = Boolean(values["apply_intro_discount"]);
    if (applyIntro) {
      if (!isOwner) {
        toast.error("Only an owner can approve the introductory discount.");
        applyIntro = false;
      } else if (!pkg.intro_discount_eligible || pkg.category.toLowerCase().includes("web")) {
        toast.error("This package is not eligible for the introductory discount.");
        applyIntro = false;
      } else if (await introDiscountUsed(customerId, pkg.id)) {
        toast.error("This customer already used the introductory discount on this package.");
        applyIntro = false;
      }
    }

    return createQuotationFromPackage({
      customerId,
      pkg,
      title: (values["title"] as string) || pkg.name,
      issue_date: String(values["issue_date"]),
      valid_until: (values["valid_until"] as string) || null,
      notes: (values["notes"] as string) ?? null,
      advancePercent: Number(values["advance_percent"] ?? 50),
      applyIntroDiscount: applyIntro,
      approvedBy: applyIntro ? (user?.id ?? null) : null,
      ...(values["lead_id"] ? { extra: { lead_id: values["lead_id"] } } : {}),
    });
  };

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
        description="The customer's package, scope and pricing load automatically, with the advance split applied."
        fields={fields}
        initial={{
          issue_date: new Date().toISOString().slice(0, 10),
          advance_percent: 50,
          apply_intro_discount: false,
        }}
        saving={saving}
        onSubmit={async (values) => {
          setSaving(true);
          try {
            const created = await createQuotation(values);
            setOpen(false);
            toast.success(`Quotation ${created.number} created.`);
            navigate({ to: "/quotations/$id", params: { id: created.id } });
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
