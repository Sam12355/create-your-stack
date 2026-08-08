import { createFileRoute, Link } from "@tanstack/react-router";
import { CrudPage, type Column } from "@/components/crud-page";
import { type Field } from "@/components/record-dialog";
import { humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";

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
  code: string | null;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  customer_type: string;
};

const TYPES = [
  "monthly_retainer",
  "one_time",
  "studio_rental",
  "website",
  "video_production",
  "other",
];

const FIELDS: Field[] = [
  { name: "name", label: "Customer / company name", required: true },
  { name: "code", label: "Customer code", placeholder: "auto if blank" },
  { name: "company", label: "Company" },
  { name: "contact_person", label: "Contact person" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "whatsapp", label: "WhatsApp", type: "tel" },
  { name: "email", label: "Email", type: "email" },
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

function CustomersPage() {
  const columns: Column<Customer>[] = [
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
    { key: "customer_type", header: "Type", cell: (r) => humanize(r.customer_type) },
  ];

  return (
    <CrudPage<Customer>
      table="customers"
      title="Customers"
      description="Every customer record, contact detail and history in one place."
      addLabel="New customer"
      order={{ column: "created_at", ascending: false }}
      searchKeys={["name", "company", "phone", "email"]}
      columns={columns}
      fields={FIELDS}
      defaults={{ customer_type: "one_time" }}
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
