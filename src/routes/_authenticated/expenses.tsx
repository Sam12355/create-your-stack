import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type Column } from "@/components/crud-page";
import { type Field } from "@/components/record-dialog";
import { formatDate, formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/ui-bits";
import { useList } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — VYBE Business System" },
      { name: "description", content: "Track business and project expenses by category." },
    ],
  }),
  component: ExpensesPage,
});

type Expense = {
  id: string;
  spent_on: string;
  category: string | null;
  description: string;
  amount: number;
  project_id: string | null;
  receipt_url: string | null;
};

const CATEGORIES = [
  "Equipment",
  "Software",
  "Travel",
  "Salaries",
  "Rent",
  "Utilities",
  "Marketing",
  "Subcontractor",
  "Other",
];

function ExpensesPage() {
  const projects = useList<{ id: string; title: string }>("projects", {
    order: { column: "created_at", ascending: false },
  });
  const projectName = (id: string | null) =>
    (projects.data ?? []).find((p) => p.id === id)?.title ?? "—";

  const fields: Field[] = [
    { name: "spent_on", label: "Date", type: "date", required: true },
    {
      name: "category",
      label: "Category",
      type: "select",
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
    },
    { name: "amount", label: "Amount (LKR)", type: "money", required: true },
    {
      name: "project_id",
      label: "Link to project",
      type: "select",
      options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.title })),
    },
    { name: "receipt_url", label: "Receipt link" },
    { name: "description", label: "Description", type: "textarea", required: true },
  ];

  const columns: Column<Expense>[] = [
    { key: "spent_on", header: "Date", cell: (r) => formatDate(r.spent_on) },
    {
      key: "category",
      header: "Category",
      cell: (r) => (r.category ? <StatusBadge value={r.category} /> : "—"),
    },
    { key: "description", header: "Description" },
    { key: "project_id", header: "Project", cell: (r) => projectName(r.project_id) },
    {
      key: "amount",
      header: "Amount",
      className: "tabular",
      cell: (r) => formatMoney(r.amount),
    },
  ];

  return (
    <CrudPage<Expense>
      table="expenses"
      title="Expenses"
      description="Everything the business spends, optionally tied to a project."
      addLabel="New expense"
      order={{ column: "spent_on", ascending: false }}
      searchKeys={["description", "category"]}
      columns={columns}
      fields={fields}
      defaults={{ category: "Other", spent_on: new Date().toISOString().slice(0, 10) }}
    />
  );
}
