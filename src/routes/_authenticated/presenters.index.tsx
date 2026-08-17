import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { CrudPage, type Column } from "@/components/crud-page";
import { type Field } from "@/components/record-dialog";
import { StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import {
  DURATION_UNITS,
  PRESENTER_LANGUAGES,
  PRESENTER_TYPES,
  PRICING_METHODS,
  type Presenter,
} from "@/lib/presenters";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/presenters/")({
  head: () => ({
    meta: [
      { title: "Presenters — VYBE Business System" },
      {
        name: "description",
        content: "Presenter profiles, default duration pricing and travel charges.",
      },
    ],
  }),
  component: PresentersPage,
});

function PresentersPage() {
  const { isOwner } = useSession();

  const fields: Field[] = [
    { name: "name", label: "Presenter name", required: true },
    { name: "display_name", label: "Display / professional name" },
    { name: "phone", label: "Phone number", type: "tel" },
    { name: "whatsapp", label: "WhatsApp number", type: "tel" },
    { name: "email", label: "Email address", type: "email" },
    { name: "address", label: "Address / main location" },
    {
      name: "presenter_types",
      label: "Presenter type (choose any that apply)",
      type: "multi",
      options: PRESENTER_TYPES.map((t) => ({ value: t, label: t })),
    },
    {
      name: "custom_type",
      label: "Custom type",
      help: "Used when 'Custom' is selected above.",
    },
    {
      name: "languages",
      label: "Languages",
      type: "multi",
      options: PRESENTER_LANGUAGES.map((l) => ({ value: l, label: l })),
    },
    { name: "short_description", label: "Short description", type: "textarea" },
    { name: "photo_url", label: "Profile photo link" },

    {
      name: "pricing_method",
      label: "Pricing method",
      type: "select",
      required: true,
      options: PRICING_METHODS,
      help: "Price tiers are managed on the presenter's own page.",
    },
    {
      name: "base_duration",
      label: "Normal video duration",
      type: "number",
      required: true,
    },
    {
      name: "duration_unit",
      label: "Duration unit",
      type: "select",
      required: true,
      options: DURATION_UNITS.map((u) => ({ value: u, label: u })),
    },
    { name: "base_price", label: "Normal presenter charge (LKR)", type: "money", required: true },
    { name: "additional_unit", label: "Additional duration unit", type: "number" },
    { name: "additional_price", label: "Additional-duration charge (LKR)", type: "money" },
    { name: "travel_charge", label: "Normal travel charge (LKR)", type: "money" },
    { name: "pricing_notes", label: "Pricing notes", type: "textarea" },
    { name: "notes", label: "General notes", type: "textarea" },
    { name: "is_active", label: "Active", type: "switch" },
  ];

  const typeLabel = (r: Presenter) => {
    const types = (r.presenter_types ?? []).map((t) => (t === "Custom" ? r.custom_type || t : t));
    const langs = r.languages ?? [];
    return [types.join(", "), langs.join(" / ")].filter(Boolean).join(" · ") || "—";
  };

  const columns: Column<Presenter>[] = [
    { key: "presenter_no", header: "Presenter ID", className: "whitespace-nowrap" },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <span>
          <span className="font-medium">{r.name}</span>
          {r.display_name ? (
            <span className="block text-xs text-muted-foreground">{r.display_name}</span>
          ) : null}
        </span>
      ),
    },
    { key: "presenter_types", header: "Type / language", cell: typeLabel },
    {
      key: "base_duration",
      header: "Normal duration",
      className: "whitespace-nowrap",
      cell: (r) => `${r.base_duration} ${r.duration_unit}`,
    },
    {
      key: "base_price",
      header: "Normal charge",
      className: "tabular whitespace-nowrap",
      cell: (r) => formatMoney(r.base_price),
    },
    {
      key: "additional_price",
      header: "Additional rate",
      className: "tabular whitespace-nowrap",
      cell: (r) =>
        Number(r.additional_price) > 0
          ? `${formatMoney(r.additional_price)} / ${r.additional_unit} ${r.duration_unit}`
          : "—",
    },
    {
      key: "travel_charge",
      header: "Default travel",
      className: "tabular whitespace-nowrap",
      cell: (r) => (Number(r.travel_charge) > 0 ? formatMoney(r.travel_charge) : "—"),
    },
    {
      key: "is_active",
      header: "Status",
      cell: (r) => <StatusBadge value={r.is_active ? "active" : "inactive"} />,
    },
  ];

  return (
    <CrudPage<Presenter>
      table="presenters"
      title="Presenters"
      description={
        isOwner
          ? "Presenter profiles and their default duration-based pricing. Changing a default price affects future quotations only."
          : "Presenter profiles. Only an owner can add or change default pricing."
      }
      addLabel="New presenter"
      order={{ column: "presenter_no", ascending: true }}
      searchKeys={["presenter_no", "name", "display_name", "phone", "email", "address"]}
      columns={columns}
      fields={fields}
      defaults={{
        pricing_method: "base_additional",
        base_duration: 1,
        duration_unit: "minute",
        base_price: 0,
        additional_unit: 1,
        additional_price: 0,
        travel_charge: 0,
        is_active: true,
        presenter_types: [],
        languages: [],
      }}
      rowActions={(r) => (
        <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="View presenter">
          <Link to="/presenters/$id" params={{ id: r.id }}>
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
      )}
    />
  );
}
