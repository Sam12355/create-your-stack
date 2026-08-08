import { insertRow, nextNumber, selectAll, updateRow, type Row } from "./api";
import { documentTotals, introDiscountFor, round, splitAdvance } from "./money";

export type PackageRow = {
  id: string;
  code: string | null;
  name: string;
  category: string;
  short_description: string | null;
  scope: string | null;
  deliverables: string | null;
  exclusions: string | null;
  inclusions: string[] | null;
  base_price: number;
  tax_rate: number;
  billing_type: string;
  duration_note: string | null;
  revisions: number | null;
  deposit_percent: number;
  allow_discount: boolean;
  intro_discount_type: string | null;
  intro_discount_value: number;
  intro_discount_eligible: boolean;
  workflow_template_id: string | null;
  is_active: boolean;
};

/** Frozen copy of a package as it was at the moment a document was created. */
export function packageSnapshot(pkg: PackageRow) {
  return {
    id: pkg.id,
    code: pkg.code,
    name: pkg.name,
    category: pkg.category,
    short_description: pkg.short_description,
    scope: pkg.scope,
    inclusions: pkg.inclusions ?? [],
    deliverables: pkg.deliverables,
    exclusions: pkg.exclusions,
    base_price: Number(pkg.base_price),
    tax_rate: Number(pkg.tax_rate),
    billing_type: pkg.billing_type,
    duration_note: pkg.duration_note,
    revisions: pkg.revisions,
    workflow_template_id: pkg.workflow_template_id,
    snapshot_at: new Date().toISOString(),
  };
}

/** Group packages for a dropdown: active first, then inactive. */
export function packageOptions(list: PackageRow[]) {
  const label = (p: PackageRow) => `${p.name} — ${p.category}`;
  return [
    ...list
      .filter((p) => p.is_active)
      .map((p) => ({ value: p.id, label: label(p), group: "Active packages" })),
    ...list
      .filter((p) => !p.is_active)
      .map((p) => ({ value: p.id, label: label(p), group: "Inactive / legacy" })),
  ];
}

/** Has this customer already had the one-off introductory discount on this package? */
export async function introDiscountUsed(customerId: string, packageId: string) {
  const rows = await selectAll<{ id: string }>("discount_applications", {
    eq: { customer_id: customerId, package_id: packageId },
    limit: 1,
  });
  return rows.length > 0;
}

export type QuoteBuildResult = { id: string; number: string };

/**
 * Create a quotation pre-loaded from the customer's package: line item, totals,
 * introductory discount (never for websites) and the 50% advance split.
 */
export async function createQuotationFromPackage(input: {
  customerId: string;
  pkg: PackageRow;
  title?: string;
  issue_date?: string;
  valid_until?: string | null;
  notes?: string | null;
  advancePercent?: number;
  applyIntroDiscount?: boolean;
  approvedBy?: string | null;
  extra?: Row;
}): Promise<QuoteBuildResult> {
  const pkg = input.pkg;
  const discount = input.applyIntroDiscount ? introDiscountFor(pkg) : 0;
  const line = {
    quantity: 1,
    unit_price: Number(pkg.base_price),
    discount,
    tax_rate: Number(pkg.tax_rate),
  };
  const totals = documentTotals([line]);
  const advancePercent = input.advancePercent ?? 50;
  const split = splitAdvance(totals.grand_total, advancePercent);
  const number = await nextNumber("quotation");

  const quotation = await insertRow<{ id: string }>("quotations", {
    number,
    customer_id: input.customerId,
    package_id: pkg.id,
    package_snapshot: packageSnapshot(pkg),
    title: input.title ?? pkg.name,
    issue_date: input.issue_date ?? new Date().toISOString().slice(0, 10),
    valid_until: input.valid_until ?? null,
    notes: input.notes ?? null,
    status: "draft",
    advance_percent: advancePercent,
    advance_amount: split.advance,
    balance_amount: split.balance,
    ...totals,
    ...(input.approvedBy && discount > 0
      ? { discount_approved_by: input.approvedBy, discount_approved_at: new Date().toISOString() }
      : {}),
    ...(input.extra ?? {}),
  });

  await insertRow("quotation_items", {
    quotation_id: quotation.id,
    package_id: pkg.id,
    package_snapshot: packageSnapshot(pkg),
    description: [pkg.name, pkg.short_description].filter(Boolean).join(" — "),
    quantity: 1,
    unit_price: Number(pkg.base_price),
    discount,
    tax_rate: Number(pkg.tax_rate),
    line_total: round(Number(pkg.base_price) - discount).toNumber(),
    position: 0,
  });

  if (discount > 0) {
    await insertRow("discount_applications", {
      customer_id: input.customerId,
      package_id: pkg.id,
      quotation_id: quotation.id,
      discount_type: pkg.intro_discount_type ?? "fixed",
      discount_value: Number(pkg.intro_discount_value),
      amount: discount,
      reason: "Introductory discount for first-time customer",
      approved_by: input.approvedBy ?? null,
    });
  }

  return { id: quotation.id, number };
}

/**
 * Recalculate an invoice from its line items, approved additional costs and
 * adjustments. Kept as a re-export so existing callers keep working.
 */
export { recalcInvoice } from "./documents";

