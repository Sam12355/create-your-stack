import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { deleteRow, insertRow, logActivity, updateRow, useList, type Row } from "@/lib/api";
import { d, formatMoney, round } from "@/lib/money";
import {
  additionalFor,
  lineFromPresenter,
  pickTier,
  presenterBreakdown,
  presenterLabel,
  presenterLineTotals,
  type Presenter,
  type PresenterLine,
  type PresenterTier,
} from "@/lib/presenters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, StatusBadge } from "@/components/ui-bits";

type Draft = Omit<PresenterLine, "id"> & { id?: string };

const EMPTY: Draft = {
  presenter_id: null,
  presenter_no: null,
  presenter_name: "",
  presenter_snapshot: null,
  duration: 1,
  duration_unit: "minute",
  tier_label: null,
  videos: 1,
  base_rate: 0,
  additional_duration: 0,
  additional_rate: 0,
  additional_amount: 0,
  travel_required: false,
  travel_location: null,
  travel_charge: 0,
  travel_visits: 1,
  travel_notes: null,
  other_charges: 0,
  other_charges_note: null,
  pricing_notes: null,
  performance_total: 0,
  travel_total: 0,
  total: 0,
  position: 0,
};

/** Presenter charges on a quotation or an invoice draft. */
export function PresenterLines({
  table,
  parentKey,
  parentId,
  locked,
  onChanged,
  /** Invoices only: compare against the price frozen on the accepted quotation. */
  showAdjustment,
}: {
  table: "quotation_presenters" | "invoice_presenters";
  parentKey: "quotation_id" | "invoice_id";
  parentId: string;
  locked?: boolean;
  onChanged?: () => void | Promise<void>;
  showAdjustment?: boolean;
}) {
  const qc = useQueryClient();
  const rowsQ = useList<PresenterLine & { quoted_total?: number; adjustment_reason?: string | null }>(
    table,
    { eq: { [parentKey]: parentId }, order: { column: "position", ascending: true } },
  );
  const presenters = useList<Presenter>("presenters", {
    order: { column: "name", ascending: true },
  });
  const tiers = useList<PresenterTier>("presenter_rate_tiers", {
    order: { column: "position", ascending: true },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<(PresenterLine & { quoted_total?: number }) | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = rowsQ.data ?? [];
  const totals = presenterBreakdown(rows);

  const refresh = async () => {
    await onChanged?.();
    await qc.invalidateQueries({ queryKey: [table] });
  };

  const remove = async (row: PresenterLine) => {
    if (!confirm(`Remove ${row.presenter_name} from this document?`)) return;
    await deleteRow(table, row.id);
    await logActivity(table, row.id, "presenter removed", { presenter: row.presenter_name });
    await refresh();
  };

  const save = async (draft: Draft) => {
    setBusy(true);
    try {
      const computed = { ...draft, ...presenterLineTotals(draft) };
      const payload: Row = {
        [parentKey]: parentId,
        presenter_id: computed.presenter_id,
        presenter_no: computed.presenter_no,
        presenter_name: computed.presenter_name,
        presenter_snapshot: computed.presenter_snapshot as unknown as Row,
        duration: computed.duration,
        duration_unit: computed.duration_unit,
        tier_label: computed.tier_label,
        videos: computed.videos,
        base_rate: computed.base_rate,
        additional_duration: computed.additional_duration,
        additional_rate: computed.additional_rate,
        additional_amount: computed.additional_amount,
        travel_required: computed.travel_required,
        travel_location: computed.travel_location,
        travel_charge: computed.travel_charge,
        travel_visits: computed.travel_visits,
        travel_notes: computed.travel_notes,
        other_charges: computed.other_charges,
        other_charges_note: computed.other_charges_note,
        pricing_notes: computed.pricing_notes,
        performance_total: computed.performance_total,
        travel_total: computed.travel_total,
        total: computed.total,
        position: computed.position ?? rows.length,
      };
      if (editing) {
        // Invoice rows keep the quoted figure untouched so the adjustment stays visible.
        if (showAdjustment) payload["adjustment_reason"] = (draft as Draft & { adjustment_reason?: string | null }).adjustment_reason ?? null;
        await updateRow(table, editing.id, payload);
        await logActivity(table, editing.id, "presenter charge edited", {
          presenter: computed.presenter_name,
          total: computed.total,
        });
      } else {
        if (showAdjustment) payload["quoted_total"] = computed.total;
        const created = await insertRow<{ id: string }>(table, payload);
        await logActivity(table, created.id, "presenter added", {
          presenter: computed.presenter_name,
          total: computed.total,
        });
      }
      await refresh();
      setOpen(false);
      setEditing(null);
      toast.success(editing ? "Presenter charge updated." : "Presenter added.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the presenter");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Presenter details</CardTitle>
        {!locked ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <UserRoundPlus className="mr-1.5 h-4 w-4" /> Add presenter
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            title="No presenter on this document"
            description="Add a presenter to include their fee and travel as separate charges."
          />
        ) : (
          rows.map((r) => {
            const adjustment = showAdjustment
              ? round(d(r.total).minus(d(r.quoted_total ?? 0))).toNumber()
              : 0;
            return (
              <div key={r.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.presenter_name}</span>
                    {r.presenter_no ? (
                      <span className="text-xs text-muted-foreground">{r.presenter_no}</span>
                    ) : null}
                    <StatusBadge value={`${r.duration} ${r.duration_unit}`} />
                    {Number(r.videos) > 1 ? (
                      <span className="text-xs text-muted-foreground">× {r.videos} videos</span>
                    ) : null}
                    {r.tier_label ? (
                      <span className="text-xs text-muted-foreground">{r.tier_label}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular font-semibold">{formatMoney(r.total)}</span>
                    {!locked ? (
                      <>
                        <button
                          aria-label="Edit presenter charge"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditing(r);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Remove presenter"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void remove(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    Performance {formatMoney(r.performance_total)}
                    {Number(r.additional_amount) > 0
                      ? ` (base ${formatMoney(r.base_rate)} + additional ${formatMoney(r.additional_amount)})`
                      : ""}
                  </span>
                  {Number(r.travel_total) > 0 ? (
                    <span>
                      Travel {formatMoney(r.travel_total)}
                      {r.travel_location ? ` — ${r.travel_location}` : ""}
                      {Number(r.travel_visits) > 1 ? ` × ${r.travel_visits} visits` : ""}
                    </span>
                  ) : null}
                  {Number(r.other_charges) > 0 ? (
                    <span>
                      Other {formatMoney(r.other_charges)}
                      {r.other_charges_note ? ` — ${r.other_charges_note}` : ""}
                    </span>
                  ) : null}
                </div>
                {showAdjustment && adjustment !== 0 ? (
                  <p className="mt-1 text-xs font-medium text-warning-foreground">
                    Quoted {formatMoney(r.quoted_total ?? 0)} · adjustment{" "}
                    {adjustment > 0 ? "+" : ""}
                    {formatMoney(adjustment)}
                    {r.adjustment_reason ? ` — ${r.adjustment_reason}` : ""}
                  </p>
                ) : null}
                {r.pricing_notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{r.pricing_notes}</p>
                ) : null}
              </div>
            );
          })
        )}

        {rows.length > 0 ? (
          <dl className="grid gap-1 border-t border-border pt-3 text-sm sm:grid-cols-2">
            {[
              ["Presenter performance total", formatMoney(totals.performance_total)],
              ["Presenter travel total", formatMoney(totals.travel_total)],
              ...(totals.other_total
                ? ([["Other presenter charges", formatMoney(totals.other_total)]] as Array<
                    [string, string]
                  >)
                : []),
              ["Total presenter charges", formatMoney(totals.total)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Presenter charges are billed separately from the package and are excluded from the
          introductory discount. Editing them here never changes the presenter&rsquo;s profile price.
        </p>
      </CardContent>

      <PresenterDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
        presenters={presenters.data ?? []}
        tiers={tiers.data ?? []}
        initial={editing ?? null}
        saving={busy}
        showAdjustment={showAdjustment ?? false}
        onSubmit={save}
      />
    </Card>
  );
}

/* --------------------------------------------------------------- dialog */

function Num({
  label,
  value,
  onChange,
  step = "0.01",
  help,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  help?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        className="tabular"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      {help ? <p className="text-[11px] text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function Txt({
  label,
  value,
  onChange,
  placeholder,
  area,
  full,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  area?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {area ? (
        <Textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function PresenterDialog({
  open,
  onOpenChange,
  presenters,
  tiers,
  initial,
  saving,
  showAdjustment,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presenters: Presenter[];
  tiers: PresenterTier[];
  initial: (PresenterLine & { quoted_total?: number; adjustment_reason?: string | null }) | null;
  saving: boolean;
  showAdjustment: boolean;
  onSubmit: (d: Draft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft & { adjustment_reason?: string | null }>(EMPTY);

  useEffect(() => {
    if (open) setDraft(initial ? { ...initial } : { ...EMPTY });
  }, [open, initial]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const selected = presenters.find((p) => p.id === draft.presenter_id) ?? null;
  const myTiers = useMemo(
    () => tiers.filter((t) => t.presenter_id === draft.presenter_id),
    [tiers, draft.presenter_id],
  );

  // Live preview — the same maths the server row will store.
  const live = presenterLineTotals(draft);

  /** Re-derive the additional-time charge from the presenter's own rates. */
  const applyDuration = (duration: number) => {
    setDraft((prev) => {
      const next = { ...prev, duration };
      if (!selected) return next;
      const useTiers = selected.pricing_method === "tiers" || selected.pricing_method === "both";
      const tier = useTiers ? pickTier(duration, myTiers) : null;
      if (tier) {
        next.tier_label = tier.label;
        next.base_rate = Number(tier.price);
        next.additional_duration = 0;
        next.additional_amount = 0;
        return next;
      }
      const add = additionalFor(
        duration,
        Number(selected.base_duration ?? 0),
        Number(selected.additional_unit ?? 1),
        Number(selected.additional_price ?? 0),
      );
      next.tier_label = null;
      next.additional_duration = add.additional_duration;
      next.additional_amount = add.additional_amount;
      return next;
    });
  };

  const choosePresenter = (id: string) => {
    const p = presenters.find((x) => x.id === id);
    if (!p) return;
    const seeded = lineFromPresenter(p, tiers.filter((t) => t.presenter_id === id));
    setDraft((prev) => ({ ...prev, ...seeded, position: prev.position ?? 0 }));
  };

  const active = presenters.filter((p) => p.is_active);
  const inactive = presenters.filter((p) => !p.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit presenter charge" : "Add presenter"}</DialogTitle>
          <DialogDescription>
            Rates load from the presenter&rsquo;s profile and stay editable for this document only.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.presenter_name.trim()) {
              toast.error("Select a presenter first.");
              return;
            }
            void onSubmit(draft);
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Presenter</Label>
            <Select value={draft.presenter_id ?? ""} onValueChange={choosePresenter}>
              <SelectTrigger>
                <SelectValue placeholder="Select a presenter…" />
              </SelectTrigger>
              <SelectContent>
                {active.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Active</SelectLabel>
                    {active.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {presenterLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {inactive.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Inactive</SelectLabel>
                    {inactive.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {presenterLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
            {selected ? (
              <p className="text-[11px] text-muted-foreground">
                Profile default: {selected.base_duration} {selected.duration_unit} @{" "}
                {formatMoney(selected.base_price)} · additional {selected.additional_unit}{" "}
                {selected.duration_unit} @ {formatMoney(selected.additional_price)} · travel{" "}
                {formatMoney(selected.travel_charge)}
                {myTiers.length > 0 ? ` · ${myTiers.length} price tier(s)` : ""}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Num label="Required duration" value={Number(draft.duration)} onChange={applyDuration} />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Duration unit</Label>
              <Input
                value={draft.duration_unit}
                onChange={(e) => set("duration_unit", e.target.value)}
              />
            </div>
            <Num
              label="Number of videos"
              step="1"
              value={Number(draft.videos)}
              onChange={(n) => set("videos", Math.max(1, Math.round(n)))}
            />
          </div>

          {myTiers.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Duration tier</Label>
              <Select
                value={draft.tier_label ?? "__none"}
                onValueChange={(v) => {
                  if (v === "__none") {
                    set("tier_label", null);
                    return;
                  }
                  const t = myTiers.find((x) => (x.label ?? "") === v);
                  if (!t) return;
                  setDraft((prev) => ({
                    ...prev,
                    tier_label: t.label,
                    base_rate: Number(t.price),
                    additional_duration: 0,
                    additional_amount: 0,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a tier…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— No tier (use base + additional) —</SelectItem>
                  {myTiers.map((t) => (
                    <SelectItem key={t.id} value={t.label ?? t.id}>
                      {t.label ?? `Up to ${t.up_to_duration}`} — {formatMoney(t.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Num
              label="Presenter rate for this project"
              value={Number(draft.base_rate)}
              onChange={(n) => set("base_rate", n)}
              help="Overrides the profile default for this document only."
            />
            <Num
              label="Additional-duration charge"
              value={Number(draft.additional_amount)}
              onChange={(n) => set("additional_amount", n)}
              help={`${draft.additional_duration} ${draft.duration_unit} over base`}
            />
            <Num
              label="Additional rate per unit"
              value={Number(draft.additional_rate)}
              onChange={(n) => set("additional_rate", n)}
            />
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-3 flex items-center justify-between">
              <Label className="text-sm font-medium">Travel required</Label>
              <Switch
                checked={Boolean(draft.travel_required)}
                onCheckedChange={(v) => set("travel_required", v)}
              />
            </div>
            {draft.travel_required ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Txt
                  label="Recording location"
                  value={draft.travel_location ?? ""}
                  onChange={(s) => set("travel_location", s || null)}
                  placeholder="Colombo"
                />
                <Num
                  label="Travel charge per visit"
                  value={Number(draft.travel_charge)}
                  onChange={(n) => set("travel_charge", n)}
                />
                <Num
                  label="Number of visits / days"
                  step="1"
                  value={Number(draft.travel_visits)}
                  onChange={(n) => set("travel_visits", Math.max(0, Math.round(n)))}
                />
                <Txt
                  label="Travel notes"
                  value={draft.travel_notes ?? ""}
                  onChange={(s) => set("travel_notes", s || null)}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No travel charge will be added for this presenter.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              label="Other presenter-related charge"
              value={Number(draft.other_charges)}
              onChange={(n) => set("other_charges", n)}
            />
            <Txt
              label="What is the other charge for?"
              value={draft.other_charges_note ?? ""}
              onChange={(s) => set("other_charges_note", s || null)}
            />
            <Txt
              label="Pricing notes"
              value={draft.pricing_notes ?? ""}
              onChange={(s) => set("pricing_notes", s || null)}
              area
              full
            />
            {showAdjustment ? (
              <Txt
                label="Reason for changing the quoted price"
                value={draft.adjustment_reason ?? ""}
                onChange={(s) => setDraft((p) => ({ ...p, adjustment_reason: s || null }))}
                placeholder="Longer recording session agreed with the client"
                full
              />
            ) : null}
          </div>

          <dl className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
            {[
              ["Performance total", formatMoney(live.performance_total)],
              ["Travel total", formatMoney(live.travel_total)],
              ["Other charges", formatMoney(draft.other_charges)],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <dt className="text-muted-foreground">{l}</dt>
                <dd className="tabular">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>Total presenter charge</dt>
              <dd className="tabular">{formatMoney(live.total)}</dd>
            </div>
          </dl>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : initial ? "Save changes" : "Add presenter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { Plus as PresenterPlusIcon };
