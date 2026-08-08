import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateRow, useList } from "@/lib/api";
import { PageHeader } from "@/components/app-shell";
import { FieldGrid, type Field, type Values } from "@/components/record-dialog";
import { ErrorNote, Loading } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — VYBE Business System" },
      { name: "description", content: "Business details, numbering prefixes, tax and terms." },
    ],
  }),
  component: SettingsPage,
});

const FIELDS: Field[] = [
  { name: "business_name", label: "Business name", required: true },
  { name: "logo_url", label: "Logo URL" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "website", label: "Website" },
  { name: "tax_number", label: "Tax number" },
  { name: "currency", label: "Currency" },
  { name: "default_tax_rate", label: "Default tax rate %", type: "number" },
  { name: "invoice_prefix", label: "Invoice prefix" },
  { name: "quotation_prefix", label: "Quotation prefix" },
  { name: "project_prefix", label: "Project prefix" },
  { name: "reminder_days_before_work", label: "Remind days before work", type: "number" },
  { name: "reminder_days_before_due", label: "Remind days before due", type: "number" },
  { name: "address", label: "Address", type: "textarea" },
  { name: "bank_details", label: "Bank details", type: "textarea" },
  { name: "brand_primary", label: "Brand colour (hex)", placeholder: "#6D28D9" },
  { name: "signature_label", label: "Signature label", placeholder: "For VYBE Creative Media" },
  { name: "default_advance_percent", label: "Default advance %", type: "number" },
  { name: "advance_term", label: "Advance payment term", type: "textarea" },
  { name: "quotation_terms", label: "Quotation terms", type: "textarea" },
  { name: "invoice_terms", label: "Invoice terms", type: "textarea" },
  { name: "website_terms", label: "Website project terms", type: "textarea" },
];

function SettingsPage() {
  const { data, isLoading, error } = useList<Values & { id: boolean }>("settings");
  const [values, setValues] = useState<Values>({});
  const [saving, setSaving] = useState(false);

  const row = (data ?? [])[0];
  useEffect(() => {
    if (row) setValues(row);
  }, [row]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="These details appear on every quotation, invoice and receipt."
        actions={
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const { id: _id, ...rest } = values as Values & { id?: unknown };
                void _id;
                await updateRow("settings", "true", rest);
                toast.success("Settings saved.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Only owners can change settings");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business profile</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGrid
            fields={FIELDS}
            values={values}
            onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
