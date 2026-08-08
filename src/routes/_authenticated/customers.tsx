import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CrudPage, type Column } from "@/components/crud-page";
import { type Field } from "@/components/record-dialog";
import { humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { insertRow, nextNumber, updateRow, useList } from "@/lib/api";
import { packageOptions, packageSnapshot, type PackageRow } from "@/lib/quote";
import { applyTemplateToProject } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — VYBE Business System" },
      { name: "description", content: "Searchable customer list with full 360° profiles." },
    ],
  }),
  component: CustomersPage,
});

type Customer = {
  id: string;
  customer_no: string | null;
  code: string | null;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  customer_type: string;
  package_id: string | null;
};

const TYPES = [
  "monthly_retainer",
  "one_time",
  "studio_rental",
  "website",
  "video_production",
  "other",
];

function CustomersPage() {
  const navigate = useNavigate();
  const packages = useList<PackageRow>("packages", {
    order: { column: "category", ascending: true },
  });
  const packageList = packages.data ?? [];

  const fields: Field[] = [
    { name: "name", label: "Customer / company name", required: true },
    { name: "company", label: "Company" },
    { name: "contact_person", label: "Contact person" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "whatsapp", label: "WhatsApp", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    {
      name: "package_id",
      label: "Package / service",
      type: "select",
      required: true,
      full: true,
      options: packageOptions(packageList),
      help: "Mandatory. A first project is opened automatically from this package, with its workflow stages.",
    },
    { name: "nic_br_number", label: "NIC / BR number" },
    { name: "tax_number", label: "Tax number" },
    { name: "source", label: "Lead source" },
    { name: "preferred_contact", label: "Preferred contact method" },
    {
      name: "customer_type",
      label: "Customer type",
      type: "select",
      required: true,
      options: TYPES.map((t) => ({ value: t, label: humanize(t) })),
    },
    { name: "address", label: "Address", type: "textarea" },
    { name: "notes", label: "Internal notes", type: "textarea" },
  ];

  const columns: Column<Customer>[] = [
    {
      key: "customer_no",
      header: "Customer no.",
      className: "tabular whitespace-nowrap",
      cell: (r) => r.customer_no || "—",
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <Link to="/customers/$id" params={{ id: r.id }} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: "company", header: "Company", cell: (r) => r.company || "—" },
    { key: "phone", header: "Phone", cell: (r) => r.phone || "—" },
    { key: "email", header: "Email", cell: (r) => r.email || "—" },
    {
      key: "package_id",
      header: "Package",
      cell: (r) => packageList.find((p) => p.id === r.package_id)?.name ?? "—",
    },
    { key: "customer_type", header: "Type", cell: (r) => humanize(r.customer_type) },
  ];

  /** Snapshot the chosen package and open the customer's first project from it. */
  const openFirstProject = async (customer: Customer) => {
    if (!customer.package_id) return;
    const pkg = packageList.find((p) => p.id === customer.package_id);
    if (!pkg) return;
    const snapshot = packageSnapshot(pkg);
    await updateRow("customers", customer.id, { package_snapshot: snapshot });

    const code = await nextNumber("project");
    const project = await insertRow<{ id: string }>("projects", {
      code,
      title: `${pkg.name} — ${customer.name}`,
      customer_id: customer.id,
      package_id: pkg.id,
      package_snapshot: snapshot,
      workflow_template_id: pkg.workflow_template_id,
      billing_type: pkg.billing_type,
      work_type: pkg.category,
      agreed_total: Number(pkg.base_price),
      status: "planned",
      start_date: new Date().toISOString().slice(0, 10),
    });
    if (pkg.workflow_template_id) {
      await applyTemplateToProject(project.id, pkg.workflow_template_id);
    }
    toast.success(`Project ${code} opened from ${pkg.name}.`);
    navigate({ to: "/projects/$id", params: { id: project.id } });
  };

  return (
    <CrudPage<Customer>
      table="customers"
      title="Customers"
      description="Every customer record, contact detail and history in one place. Customer numbers are generated automatically."
      addLabel="New customer"
      order={{ column: "created_at", ascending: false }}
      searchKeys={["name", "company", "phone", "email", "customer_no"]}
      columns={columns}
      fields={fields}
      defaults={{ customer_type: "one_time" }}
      afterSave={async (row, _values, isNew) => {
        if (!isNew) return;
        try {
          await openFirstProject(row as unknown as Customer);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Customer saved, but the project failed");
        }
      }}
      rowActions={(r) => (
        <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs">
          <Link to="/customers/$id" params={{ id: r.id }}>
            Open
          </Link>
        </Button>
      )}
    />
  );
}
