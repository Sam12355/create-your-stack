import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRow, insertRow, logActivity, updateRow, useList, useOne, type Row } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import {
  PAYOUT_STATUSES,
  presenterLabel,
  type Presenter,
  type PresenterPayout,
  type PresenterTier,
} from "@/lib/presenters";
import { PAYMENT_METHODS } from "@/lib/documents";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/app-shell";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/presenters/$id")({
  head: () => ({
    meta: [
      { title: "Presenter — VYBE Business System" },
      { name: "description", content: "Presenter profile, price tiers, history and payouts." },
    ],
  }),
  component: PresenterDetail,
});

type DocLink = {
  id: string;
  number: string;
  issue_date: string;
  status: string;
  customer_id: string | null;
};
type HistoryRow = {
  id: string;
  duration: number;
  duration_unit: string;
  videos: number;
  performance_total: number;
  travel_total: number;
  total: number;
  created_at: string;
  quotations?: DocLink | null;
  invoices?: DocLink | null;
};

function PresenterDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { user, isOwner } = useSession();
  const { data, isLoading, error } = useOne<Presenter>("presenters", id);

  const tiers = useList<PresenterTier>("presenter_rate_tiers", {
    eq: { presenter_id: id },
    order: { column: "position", ascending: true },
  });
  const quoteHistory = useList<HistoryRow>(
    "quotation_presenters",
    {
      eq: { presenter_id: id },
      select:
        "id, duration, duration_unit, videos, performance_total, travel_total, total, created_at, quotations(id, number, issue_date, status, customer_id)",
      order: { column: "created_at", ascending: false },
    },
    ["presenter-history"],
  );
  const invoiceHistory = useList<HistoryRow>(
    "invoice_presenters",
    {
      eq: { presenter_id: id },
      select:
        "id, duration, duration_unit, videos, performance_total, travel_total, total, created_at, invoices(id, number, issue_date, status, customer_id)",
      order: { column: "created_at", ascending: false },
    },
    ["presenter-history"],
  );
  const payouts = useList<PresenterPayout>("presenter_payouts", {
    eq: { presenter_id: id },
    order: { column: "created_at", ascending: false },
  });
  const customers = useList<{ id: string; name: string }>("customers");
  const projects = useList<{ id: string; title: string }>("projects");

  const [tierOpen, setTierOpen] = useState(false);
  const [editTier, setEditTier] = useState<PresenterTier | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [editPayout, setEditPayout] = useState<PresenterPayout | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <ErrorNote error={new Error("Presenter not found")} />;

  const p = data;
  const customerName = (cid: string | null | undefined) =>
    (customers.data ?? []).find((c) => c.id === cid)?.name ?? "—";

  const ownerOnly = () => {
    if (isOwner) return true;
    toast.error("Only an owner can change presenter pricing.");
    return false;
  };

  const refreshTiers = () => qc.invalidateQueries({ queryKey: ["presenter_rate_tiers"] });

  const saveTier = async (values: Values) => {
    const payload: Row = {
      presenter_id: id,
      label: (values["label"] as string) || null,
      up_to_duration:
        values["up_to_duration"] === null || values["up_to_duration"] === ""
          ? null
          : Number(values["up_to_duration"]),
      price: Number(values["price"] ?? 0),
      is_custom: values["up_to_duration"] == null || values["up_to_duration"] === "",
      position: Number(values["position"] ?? (tiers.data ?? []).length),
    };
    try {
      if (editTier) await updateRow("presenter_rate_tiers", editTier.id, payload);
      else await insertRow("presenter_rate_tiers", payload);
      await logActivity(
        "presenter",
        id,
        editTier ? "price tier updated" : "price tier added",
        payload,
      );
      refreshTiers();
      setTierOpen(false);
      setEditTier(null);
      toast.success("Price tier saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the tier");
    }
  };

  const savePayout = async (values: Values) => {
    const payload: Row = {
      presenter_id: id,
      project_id: values["project_id"] || null,
      amount_charged: Number(values["amount_charged"] ?? 0),
      amount_payable: Number(values["amount_payable"] ?? 0),
      amount_paid: Number(values["amount_paid"] ?? 0),
      paid_on: values["paid_on"] || null,
      method: values["method"] || null,
      reference: (values["reference"] as string) || null,
      note: (values["note"] as string) || null,
    };
    try {
      if (editPayout) await updateRow("presenter_payouts", editPayout.id, payload);
      else await insertRow("presenter_payouts", { ...payload, created_by: user?.id ?? null });
      await logActivity("presenter", id, "payout recorded", payload);
      qc.invalidateQueries({ queryKey: ["presenter_payouts"] });
      setPayoutOpen(false);
      setEditPayout(null);
      toast.success("Presenter payout saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the payout");
    }
  };

  const toggleActive = async () => {
    if (!ownerOnly()) return;
    await updateRow("presenters", id, { is_active: !p.is_active });
    await logActivity("presenter", id, p.is_active ? "deactivated" : "activated");
    qc.invalidateQueries({ queryKey: ["presenters"] });
    toast.success(p.is_active ? "Presenter deactivated." : "Presenter activated.");
  };

  const tierFields: Field[] = [
    {
      name: "label",
      label: "Tier label",
      placeholder: "Up to 2 minutes",
      required: true,
      full: true,
    },
    {
      name: "up_to_duration",
      label: `Up to (${p.duration_unit}s)`,
      type: "number",
      help: "Leave empty for a custom / open-ended tier.",
    },
    { name: "price", label: "Tier price (LKR)", type: "money", required: true },
    { name: "position", label: "Order", type: "number" },
  ];

  const payoutFields: Field[] = [
    {
      name: "project_id",
      label: "Project",
      type: "select",
      options: (projects.data ?? []).map((x) => ({ value: x.id, label: x.title })),
    },
    {
      name: "amount_charged",
      label: "Amount charged to customer (LKR)",
      type: "money",
      help: "What the client was billed for this presenter.",
    },
    {
      name: "amount_payable",
      label: "Amount payable to presenter (LKR)",
      type: "money",
      help: "What VYBE owes the presenter — often a different figure.",
    },
    { name: "amount_paid", label: "Amount already paid (LKR)", type: "money" },
    { name: "paid_on", label: "Payment date", type: "date" },
    {
      name: "method",
      label: "Payment method",
      type: "select",
      options: PAYMENT_METHODS.map((m) => ({ value: m, label: humanize(m) })),
    },
    { name: "reference", label: "Payment reference" },
    { name: "note", label: "Payment note", type: "textarea" },
  ];

  const payoutRows = payouts.data ?? [];
  const owed = payoutRows.reduce((s, r) => s + Number(r.amount_payable) - Number(r.amount_paid), 0);
  const charged = payoutRows.reduce((s, r) => s + Number(r.amount_charged), 0);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/presenters">
          <ArrowLeft className="mr-1 h-4 w-4" /> All presenters
        </Link>
      </Button>

      <PageHeader
        title={presenterLabel(p)}
        description={[
          (p.presenter_types ?? []).join(", "),
          (p.languages ?? []).join(" / "),
          p.phone,
          p.email,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <StatusBadge value={p.is_active ? "active" : "inactive"} />
            <Button variant="outline" onClick={() => void toggleActive()}>
              {p.is_active ? "Deactivate" : "Activate"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Normal charge"
          value={formatMoney(p.base_price)}
          hint={`per ${p.base_duration} ${p.duration_unit}`}
          tone="primary"
        />
        <StatCard
          label="Additional rate"
          value={formatMoney(p.additional_price)}
          hint={`per ${p.additional_unit} ${p.duration_unit}`}
          tone="info"
        />
        <StatCard label="Default travel" value={formatMoney(p.travel_charge)} tone="warning" />
        <StatCard
          label="Outstanding to presenter"
          value={formatMoney(owed)}
          hint={`Charged to clients ${formatMoney(charged)}`}
          tone={owed > 0 ? "danger" : "success"}
        />
      </div>

      {p.short_description || p.pricing_notes || p.notes || p.address ? (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {p.address ? <p>{p.address}</p> : null}
            {p.short_description ? <p>{p.short_description}</p> : null}
            {p.pricing_notes ? (
              <p>
                <span className="font-medium text-foreground">Pricing notes: </span>
                {p.pricing_notes}
              </p>
            ) : null}
            {p.notes ? (
              <p>
                <span className="font-medium text-foreground">Notes: </span>
                {p.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------ duration tiers */}
      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Duration price tiers</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!ownerOnly()) return;
              setEditTier(null);
              setTierOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add tier
          </Button>
        </CardHeader>
        <CardContent>
          {(tiers.data ?? []).length === 0 ? (
            <EmptyState
              title="No price tiers"
              description={`This presenter is priced as ${p.base_duration} ${p.duration_unit} at ${formatMoney(p.base_price)}, plus ${formatMoney(p.additional_price)} per additional ${p.additional_unit} ${p.duration_unit}.`}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Up to</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tiers.data ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.label ?? "—"}</TableCell>
                    <TableCell>
                      {t.up_to_duration != null
                        ? `${t.up_to_duration} ${p.duration_unit}`
                        : "Custom duration"}
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(t.price)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <button
                          aria-label="Edit tier"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            if (!ownerOnly()) return;
                            setEditTier(t);
                            setTierOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Remove tier"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={async () => {
                            if (!ownerOnly()) return;
                            if (!confirm(`Remove tier "${t.label ?? ""}"?`)) return;
                            await deleteRow("presenter_rate_tiers", t.id);
                            refreshTiers();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Changing these prices affects future quotations only — documents already created keep
            the price agreed at the time.
          </p>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------- history */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quotation history</CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryTable
            rows={quoteHistory.data ?? []}
            docOf={(r) => r.quotations ?? null}
            to="/quotations/$id"
            customerName={customerName}
            empty="This presenter is not on any quotation yet."
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invoice history</CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryTable
            rows={invoiceHistory.data ?? []}
            docOf={(r) => r.invoices ?? null}
            to="/invoices/$id"
            customerName={customerName}
            empty="This presenter is not on any invoice yet."
          />
        </CardContent>
      </Card>

      {/* ----------------------------------------------------- payouts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Presenter payments</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditPayout(null);
              setPayoutOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Record payout
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {payoutRows.length === 0 ? (
            <EmptyState
              title="No presenter payments recorded"
              description="Track what the client was charged and what is payable to the presenter — these are different figures."
            />
          ) : (
            payoutRows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={r.status} />
                  <span className="text-muted-foreground">
                    Charged {formatMoney(r.amount_charged)} · payable{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(r.amount_payable)}
                    </span>{" "}
                    · paid {formatMoney(r.amount_paid)}
                  </span>
                  {r.reference ? (
                    <span className="text-xs text-muted-foreground">{r.reference}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{formatDate(r.paid_on)}</span>
                  <button
                    aria-label="Edit payout"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditPayout(r);
                      setPayoutOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    aria-label="Delete payout"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!confirm("Delete this payout record?")) return;
                      await deleteRow("presenter_payouts", r.id);
                      qc.invalidateQueries({ queryKey: ["presenter_payouts"] });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <RecordDialog
        open={tierOpen}
        onOpenChange={(o) => {
          setTierOpen(o);
          if (!o) setEditTier(null);
        }}
        title={editTier ? "Edit price tier" : "Add price tier"}
        description="Tiers are matched by the smallest ceiling that covers the required duration."
        fields={tierFields}
        initial={{
          label: editTier?.label ?? "",
          up_to_duration: editTier?.up_to_duration ?? null,
          price: editTier?.price ?? 0,
          position: editTier?.position ?? (tiers.data ?? []).length,
        }}
        onSubmit={saveTier}
      />

      <RecordDialog
        open={payoutOpen}
        onOpenChange={(o) => {
          setPayoutOpen(o);
          if (!o) setEditPayout(null);
        }}
        title={editPayout ? "Edit presenter payout" : "Record presenter payout"}
        description="The status is derived from the amount paid against the amount payable."
        fields={payoutFields}
        initial={{
          project_id: editPayout?.project_id ?? null,
          amount_charged: editPayout?.amount_charged ?? 0,
          amount_payable: editPayout?.amount_payable ?? 0,
          amount_paid: editPayout?.amount_paid ?? 0,
          paid_on: editPayout?.paid_on ?? null,
          method: editPayout?.method ?? "bank_transfer",
          reference: editPayout?.reference ?? "",
          note: editPayout?.note ?? "",
        }}
        onSubmit={savePayout}
      />
    </div>
  );
}

function HistoryTable({
  rows,
  docOf,
  to,
  customerName,
  empty,
}: {
  rows: HistoryRow[];
  docOf: (r: HistoryRow) => DocLink | null;
  to: "/quotations/$id" | "/invoices/$id";
  customerName: (id: string | null | undefined) => string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState title="Nothing yet" description={empty} />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Presenter charge</TableHead>
            <TableHead className="text-right">Travel</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const doc = docOf(r);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  {doc ? (
                    <Link to={to} params={{ id: doc.id }} className="underline">
                      {doc.number}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{customerName(doc?.customer_id)}</TableCell>
                <TableCell>{formatDate(doc?.issue_date)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.duration} {r.duration_unit}
                  {Number(r.videos) > 1 ? ` × ${r.videos}` : ""}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatMoney(r.performance_total)}
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(r.travel_total)}</TableCell>
                <TableCell>
                  <StatusBadge value={doc?.status ?? null} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
