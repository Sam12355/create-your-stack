import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type Column } from "@/components/crud-page";
import { type Field } from "@/components/record-dialog";
import { formatMoney } from "@/lib/money";
import { humanize, StatusBadge } from "@/components/ui-bits";
import { useList } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/packages")({
  head: () => ({
    meta: [
      { title: "Packages — VYBE Business System" },
      { name: "description", content: "Service and package catalogue with pricing, tax and terms." },
    ],
  }),
  component: PackagesPage,
});

type Pkg = {
  id: string;
  code: string | null;
  name: string;
  category: string;
  base_price: number;
  billing_type: string;
  tax_rate: number;
  duration_note: string | null;
  is_active: boolean;
};

const BILLING = ["one_time", "monthly", "hourly", "per_item", "milestone"];

function PackagesPage() {
  const templates = useList<{ id: string; name: string }>("workflow_templates", {
    order: { column: "name", ascending: true },
  });

  const fields: Field[] = [
    { name: "name", label: "Package name", required: true },
    { name: "code", label: "Code", placeholder: "SM-BASIC" },
    { name: "category", label: "Category", required: true, placeholder: "Social Media" },
    {
      name: "billing_type",
      label: "Billing type",
      type: "select",
      required: true,
      options: BILLING.map((b) => ({ value: b, label: humanize(b) })),
    },
    { name: "base_price", label: "Base price (LKR)", type: "money", required: true },
    { name: "tax_rate", label: "Tax rate %", type: "number" },
    { name: "deposit_percent", label: "Deposit %", type: "number" },
    { name: "revisions", label: "Included revisions", type: "number" },
    { name: "duration_note", label: "Duration note", placeholder: "4 hours / 1 month" },
    { name: "expected_duration_days", label: "Expected duration (days)", type: "number" },
    {
      name: "workflow_template_id",
      label: "Workflow template",
      type: "select",
      options: (templates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: "intro_discount_type",
      label: "Intro discount type",
      type: "select",
      options: [
        { value: "fixed", label: "Fixed amount" },
        { value: "percent", label: "Percent" },
      ],
    },
    { name: "intro_discount_value", label: "Intro discount value", type: "money" },
    { name: "intro_discount_eligible", label: "First-time customer discount", type: "switch" },
    { name: "allow_discount", label: "Allow manual discounts", type: "switch" },
    { name: "short_description", label: "Short description", type: "textarea" },
    { name: "scope", label: "Scope of work", type: "textarea" },
    { name: "deliverables", label: "Deliverables", type: "textarea" },
    { name: "exclusions", label: "Exclusions", type: "textarea" },
    { name: "is_active", label: "Active", type: "switch" },
  ];

  const columns: Column<Pkg>[] = [
    {
      key: "name",
      header: "Package",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          {r.code ? <p className="text-xs text-muted-foreground tabular">{r.code}</p> : null}
        </div>
      ),
    },
    { key: "category", header: "Category" },
    { key: "billing_type", header: "Billing", cell: (r) => humanize(r.billing_type) },
    {
      key: "base_price",
      header: "Price",
      className: "tabular",
      cell: (r) => formatMoney(r.base_price),
    },
    { key: "duration_note", header: "Duration", cell: (r) => r.duration_note || "—" },
    {
      key: "is_active",
      header: "Status",
      cell: (r) => <StatusBadge value={r.is_active ? "active" : "inactive"} />,
    },
  ];

  return (
    <CrudPage<Pkg>
      table="packages"
      title="Packages & services"
      description="The catalogue that powers quotations, projects and invoices."
      addLabel="New package"
      order={{ column: "category", ascending: true }}
      searchKeys={["name", "category", "code"]}
      columns={columns}
      fields={fields}
      defaults={{
        is_active: true,
        allow_discount: true,
        billing_type: "one_time",
        category: "Custom",
        base_price: 0,
        tax_rate: 0,
      }}
    />
  );
}
