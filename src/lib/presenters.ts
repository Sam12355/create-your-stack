import { d, round, type Num } from "./money";

/* ------------------------------------------------------------------ types */

export type Presenter = {
  id: string;
  presenter_no: string | null;
  name: string;
  display_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  presenter_types: string[] | null;
  custom_type: string | null;
  languages: string[] | null;
  short_description: string | null;
  photo_url: string | null;
  pricing_method: "base_additional" | "tiers" | "both";
  base_duration: number;
  duration_unit: string;
  base_price: number;
  additional_unit: number;
  additional_price: number;
  travel_charge: number;
  pricing_notes: string | null;
  notes: string | null;
  is_active: boolean;
};

export type PresenterTier = {
  id: string;
  presenter_id: string;
  label: string | null;
  up_to_duration: number | null;
  price: number;
  is_custom: boolean;
  position: number;
};

/** The editable, per-document presenter terms. Shared by quotations and invoices. */
export type PresenterLine = {
  id: string;
  presenter_id: string | null;
  presenter_no: string | null;
  presenter_name: string;
  presenter_snapshot: PresenterSnapshot | null;
  duration: number;
  duration_unit: string;
  tier_label: string | null;
  videos: number;
  base_rate: number;
  additional_duration: number;
  additional_rate: number;
  additional_amount: number;
  travel_required: boolean;
  travel_location: string | null;
  travel_charge: number;
  travel_visits: number;
  travel_notes: string | null;
  other_charges: number;
  other_charges_note: string | null;
  pricing_notes: string | null;
  performance_total: number;
  travel_total: number;
  total: number;
  position: number;
};

export type QuotationPresenter = PresenterLine & { quotation_id: string };

export type InvoicePresenter = PresenterLine & {
  invoice_id: string;
  source_quotation_presenter_id: string | null;
  /** What the accepted quotation agreed. Never rewritten by invoice edits. */
  quoted_total: number;
  adjustment_reason: string | null;
};

export type PresenterPayout = {
  id: string;
  presenter_id: string;
  project_id: string | null;
  invoice_id: string | null;
  quotation_id: string | null;
  customer_id: string | null;
  expense_id: string | null;
  amount_charged: number;
  amount_payable: number;
  amount_paid: number;
  status: "not_paid" | "partially_paid" | "paid";
  paid_on: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
};

/** Frozen copy of a presenter as they were when the document was written. */
export type PresenterSnapshot = {
  id?: string;
  presenter_no?: string | null;
  name?: string;
  display_name?: string | null;
  presenter_types?: string[];
  languages?: string[];
  phone?: string | null;
  email?: string | null;
  pricing_method?: string;
  base_duration?: number;
  duration_unit?: string;
  base_price?: number;
  additional_unit?: number;
  additional_price?: number;
  travel_charge?: number;
  pricing_notes?: string | null;
  tiers?: Array<{ label: string | null; up_to_duration: number | null; price: number }>;
  snapshot_at?: string;
};

/* -------------------------------------------------------------- constants */

export const PRESENTER_TYPES = [
  "Male Presenter",
  "Female Presenter",
  "Sinhala Presenter",
  "English Presenter",
  "Bilingual Presenter",
  "Voice-over Artist",
  "Custom",
];

export const PRESENTER_LANGUAGES = ["Sinhala", "English", "Tamil", "Other"];

export const DURATION_UNITS = ["minute", "hour", "second", "day"];

export const PRICING_METHODS = [
  { value: "base_additional", label: "Base duration + additional time" },
  { value: "tiers", label: "Duration price tiers" },
  { value: "both", label: "Both (tiers, falling back to base + additional)" },
];

export const PAYOUT_STATUSES = ["not_paid", "partially_paid", "paid"];

/* ------------------------------------------------------------- snapshots */

export function presenterSnapshot(p: Presenter, tiers: PresenterTier[] = []): PresenterSnapshot {
  return {
    id: p.id,
    presenter_no: p.presenter_no,
    name: p.name,
    display_name: p.display_name,
    presenter_types: p.presenter_types ?? [],
    languages: p.languages ?? [],
    phone: p.phone,
    email: p.email,
    pricing_method: p.pricing_method,
    base_duration: Number(p.base_duration),
    duration_unit: p.duration_unit,
    base_price: Number(p.base_price),
    additional_unit: Number(p.additional_unit),
    additional_price: Number(p.additional_price),
    travel_charge: Number(p.travel_charge),
    pricing_notes: p.pricing_notes,
    tiers: tiers
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ label: t.label, up_to_duration: t.up_to_duration, price: Number(t.price) })),
    snapshot_at: new Date().toISOString(),
  };
}

export function presenterLabel(p: Pick<Presenter, "presenter_no" | "name" | "display_name">) {
  const shown = p.display_name?.trim() ? `${p.name} (${p.display_name})` : p.name;
  return p.presenter_no ? `${p.presenter_no} — ${shown}` : shown;
}

/* ----------------------------------------------------------- calculations */

/**
 * Pricing Method B: the cheapest tier whose ceiling covers the required
 * duration. Tiers with no ceiling ("Custom duration") are only used as a last
 * resort, when the duration exceeds every bounded tier.
 */
export function pickTier(duration: number, tiers: PresenterTier[]): PresenterTier | null {
  const bounded = tiers
    .filter((t) => t.up_to_duration != null)
    .sort((a, b) => Number(a.up_to_duration) - Number(b.up_to_duration));
  const match = bounded.find((t) => d(duration).lte(d(t.up_to_duration)));
  if (match) return match;
  return tiers.find((t) => t.up_to_duration == null) ?? bounded[bounded.length - 1] ?? null;
}

/**
 * Pricing Method A. Time beyond the base duration is billed in whole
 * additional units — a part-used unit counts as a full one, which is what
 * "each additional minute" means commercially.
 */
export function additionalFor(
  duration: number,
  base_duration: number,
  additional_unit: number,
  additional_price: number,
) {
  const over = d(duration).minus(d(base_duration));
  if (over.lte(0)) return { additional_duration: 0, additional_amount: 0 };
  const unit = d(additional_unit).lte(0) ? d(1) : d(additional_unit);
  const units = over.div(unit).ceil();
  return {
    additional_duration: round(over).toNumber(),
    additional_amount: round(units.mul(d(additional_price))).toNumber(),
  };
}

/**
 * Total for one presenter row (§6):
 *   (base + additional) × videos          = performance total
 *   travel charge × visits                = travel total
 *   performance + travel + other charges  = presenter total
 * Travel and "other" are per-booking, so they are NOT multiplied by videos.
 */
export function presenterLineTotals(row: {
  base_rate: Num;
  additional_amount: Num;
  videos: Num;
  travel_required?: boolean | undefined;
  travel_charge: Num;
  travel_visits: Num;
  other_charges: Num;
}) {
  const videos = d(row.videos).lte(0) ? d(1) : d(row.videos);
  const perVideo = d(row.base_rate).plus(d(row.additional_amount));
  const performance = round(perVideo.mul(videos));
  const visits = d(row.travel_visits).lte(0) ? d(0) : d(row.travel_visits);
  const travel = row.travel_required === false ? d(0) : round(d(row.travel_charge).mul(visits));
  const other = round(d(row.other_charges));
  return {
    performance_total: performance.toNumber(),
    travel_total: round(travel).toNumber(),
    total: round(performance.plus(travel).plus(other)).toNumber(),
  };
}

/** Sum of every presenter row on a document — decimal-safe. */
export function presentersTotal(rows: Array<{ total: Num }>): number {
  return round(rows.reduce((sum, r) => sum.plus(d(r.total)), d(0))).toNumber();
}

/** Split used by the PDF and the on-screen summary. */
export function presenterBreakdown(rows: PresenterLine[]) {
  const performance = rows.reduce((s, r) => s.plus(d(r.performance_total)), d(0));
  const travel = rows.reduce((s, r) => s.plus(d(r.travel_total)), d(0));
  const other = rows.reduce((s, r) => s.plus(d(r.other_charges)), d(0));
  return {
    performance_total: round(performance).toNumber(),
    travel_total: round(travel).toNumber(),
    other_total: round(other).toNumber(),
    total: round(performance.plus(travel).plus(other)).toNumber(),
  };
}

/**
 * Build a fresh document row from a presenter's current defaults. Everything
 * returned stays editable on the document — changing it never writes back to
 * the presenter's profile.
 */
export function lineFromPresenter(
  p: Presenter,
  tiers: PresenterTier[],
  opts: { duration?: number; videos?: number } = {},
) {
  const duration = opts.duration ?? Number(p.base_duration ?? 1);
  const useTiers = p.pricing_method === "tiers" || p.pricing_method === "both";
  const tier = useTiers ? pickTier(duration, tiers) : null;

  // A matching tier price already covers the whole duration, so no additional
  // time is charged on top of it.
  const base_rate = tier ? Number(tier.price) : Number(p.base_price ?? 0);
  const add =
    tier != null
      ? { additional_duration: 0, additional_amount: 0 }
      : additionalFor(
          duration,
          Number(p.base_duration ?? 0),
          Number(p.additional_unit ?? 1),
          Number(p.additional_price ?? 0),
        );

  const draft = {
    presenter_id: p.id,
    presenter_no: p.presenter_no,
    presenter_name: p.display_name?.trim() ? `${p.name} (${p.display_name})` : p.name,
    presenter_snapshot: presenterSnapshot(p, tiers),
    duration,
    duration_unit: p.duration_unit ?? "minute",
    tier_label: tier?.label ?? null,
    videos: opts.videos ?? 1,
    base_rate,
    additional_duration: add.additional_duration,
    additional_rate: Number(p.additional_price ?? 0),
    additional_amount: add.additional_amount,
    travel_required: Number(p.travel_charge ?? 0) > 0,
    travel_location: null as string | null,
    travel_charge: Number(p.travel_charge ?? 0),
    travel_visits: 1,
    travel_notes: null as string | null,
    other_charges: 0,
    other_charges_note: null as string | null,
    pricing_notes: p.pricing_notes,
  };
  return { ...draft, ...presenterLineTotals(draft) };
}

/** Recompute derived amounts after any field on a row is edited. */
export function recomputeLine<T extends Record<string, unknown>>(row: T): T {
  const totals = presenterLineTotals(row as never);
  return { ...row, ...totals };
}

/** A one-line human summary used on documents and in the PDF. */
export function presenterDescription(r: PresenterLine): string {
  const bits = [`${r.duration} ${r.duration_unit}${Number(r.duration) === 1 ? "" : "s"}`];
  if (r.tier_label) bits.push(r.tier_label);
  if (Number(r.videos) > 1) bits.push(`${r.videos} videos`);
  return `${r.presenter_name} — ${bits.join(" · ")}`;
}
