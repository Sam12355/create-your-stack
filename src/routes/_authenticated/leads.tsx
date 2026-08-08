import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useList, useSaveRow, insertRow, updateRow, logActivity } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { ErrorNote, Loading, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads — VYBE Business System" },
      { name: "description", content: "Sales pipeline from new inquiry to won." },
    ],
  }),
  component: LeadsPage,
});

const STAGES = [
  "new_inquiry",
  "contacted",
  "requirement_collected",
  "quotation_sent",
  "won",
  "lost",
  "on_hold",
] as const;

const SOURCES = ["Facebook", "Instagram", "TikTok", "Referral", "Website", "WhatsApp", "Walk-in", "Other"];

type Lead = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  requirement: string | null;
  budget: number | null;
  stage: string;
  follow_up_date: string | null;
  lost_reason: string | null;
  customer_id: string | null;
  notes: string | null;
};

const FIELDS: Field[] = [
  { name: "name", label: "Name", required: true },
  { name: "company", label: "Company" },
  { name: "phone", label: "Phone / WhatsApp", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  {
    name: "source",
    label: "Lead source",
    type: "select",
    options: SOURCES.map((s) => ({ value: s, label: s })),
  },
  {
    name: "stage",
    label: "Stage",
    type: "select",
    required: true,
    options: STAGES.map((s) => ({ value: s, label: humanize(s) })),
  },
  { name: "budget", label: "Budget (LKR)", type: "money" },
  { name: "follow_up_date", label: "Follow-up date", type: "date" },
  { name: "requirement", label: "Requirement / scope", type: "textarea" },
  { name: "lost_reason", label: "Lost / on-hold reason", type: "textarea" },
  { name: "notes", label: "Internal notes", type: "textarea" },
];

function LeadsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useList<Lead>("leads", {
    order: { column: "created_at", ascending: false },
  });
  const save = useSaveRow("leads");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const leads = data ?? [];

  const move = async (lead: Lead, stage: string) => {
    await updateRow("leads", lead.id, { stage });
    await logActivity("lead", lead.id, `stage → ${stage}`);
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const convert = async (lead: Lead) => {
    if (lead.customer_id) {
      toast.info("This lead is already converted.");
      return;
    }
    const customer = await insertRow<{ id: string }>("customers", {
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      whatsapp: lead.phone,
      email: lead.email,
      source: lead.source,
      notes: lead.requirement,
    });
    await updateRow("leads", lead.id, { customer_id: customer.id, stage: "won" });
    await logActivity("lead", lead.id, "converted to customer", { customer_id: customer.id });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    toast.success(`${lead.name} converted to a customer.`);
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Kanban pipeline with follow-up dates and one-click conversion."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New lead
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage} className="rounded-lg bg-background p-3 shadow-card">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{humanize(stage)}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((lead) => (
                  <Card key={lead.id} className="gap-0 p-3 shadow-none">
                    <button
                      className="text-left text-sm font-medium hover:underline"
                      onClick={() => {
                        setEditing(lead);
                        setOpen(true);
                      }}
                    >
                      {lead.name}
                    </button>
                    {lead.company ? (
                      <p className="text-xs text-muted-foreground">{lead.company}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      {lead.source ? <span>{lead.source}</span> : null}
                      {lead.budget ? <span className="tabular">{formatMoney(lead.budget)}</span> : null}
                      {lead.follow_up_date ? <span>↻ {formatDate(lead.follow_up_date)}</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {stage !== "won" && stage !== "lost" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            const idx = STAGES.indexOf(stage);
                            void move(lead, STAGES[Math.min(idx + 1, 4)] ?? "contacted");
                          }}
                        >
                          Advance <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      ) : null}
                      {!lead.customer_id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => void convert(lead)}
                        >
                          Convert
                        </Button>
                      ) : (
                        <span className="self-center text-[11px] text-success">Converted</span>
                      )}
                    </div>
                  </Card>
                ))}
                {items.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Empty</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Edit lead" : "New lead"}
        description="Capture the inquiry, requirement and follow-up date."
        fields={FIELDS}
        initial={editing ?? { stage: "new_inquiry" }}
        saving={save.isPending}
        onSubmit={async (values) => {
          await save.mutateAsync({ id: editing?.id, values });
          setOpen(false);
          toast.success("Lead saved.");
        }}
      />
    </div>
  );
}
