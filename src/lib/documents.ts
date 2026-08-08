import { insertRow, logActivity, nextNumber, selectAll, selectOne, updateRow } from "./api";
import { getSupabase } from "./supabase";
import { d, documentTotals, round, splitAdvance } from "./money";

/* ------------------------------------------------------------------ types */

export type PackageSnapshot = {
  id?: string;
  name?: string;
  category?: string;
  short_description?: string | null;
  scope?: string | null;
  inclusions?: string[];
  deliverables?: string | null;
  exclusions?: string | null;
  duration_note?: string | null;
  revisions?: number | null;
  workflow_template_id?: string | null;
  base_price?: number;
  tax_rate?: number;
  snapshot_at?: string;
};

export type CustomerSnapshot = {
  id?: string;
  customer_no?: string | null;
  name?: string | null;
  company?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type Quotation = {
  id: string;
  number: string;
  title: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  customer_id: string | null;
  project_id: string | null;
  invoice_id: string | null;
  package_id: string | null;
  package_snapshot: PackageSnapshot | null;
  customer_snapshot: CustomerSnapshot | null;
  package_description: string | null;
  inclusions: string[] | null;
  bank_details: string | null;
  terms_text: string | null;
  payment_instructions: string | null;
  advance_percent: number;
  advance_amount: number;
  balance_amount: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  locked: boolean;
  version: number;
  revision_of: string | null;
  amendment_reason: string | null;
};

export type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  project_id: string | null;
  quotation_id: string | null;
  status: string;
  doc_kind: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  additional_total: number;
  adjustment_total: number;
  adjustment_note: string | null;
  quotation_total: number;
  advance_expected: number;
  paid_total: number;
  balance: number;
  notes: string | null;
  locked: boolean;
  milestone_label: string | null;
  package_snapshot: PackageSnapshot | null;
  customer_snapshot: CustomerSnapshot | null;
  package_description: string | null;
  inclusions: string[] | null;
  bank_details: string | null;
  terms_text: string | null;
  payment_instructions: string | null;
  quotation_snapshot: { number?: string; issue_date?: string; grand_total?: number } | null;
  version: number;
  revision_of: string | null;
};

export type LineRow = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
  position: number;
  package_id: string | null;
};

export type AdditionalCost = {
  id: string;
  invoice_id: string;
  description: string;
  cost_type: string;
  quantity: number;
  unit_price: number;
  amount: number;
  reason: string | null;
  notes: string | null;
  approval_status: string;
  created_at: string;
  created_by: string | null;
};

export type PaymentRow = {
  id: string;
  invoice_id: string | null;
  quotation_id: string | null;
  amount: number;
  method: string;
  kind: string;
  paid_on: string;
  reference: string | null;
  proof_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "awaiting_response",
  "accepted",
  "rejected",
  "expired",
  "revised",
];

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "revised",
];

export const COST_TYPES = [
  "additional_filming",
  "studio_overtime",
  "additional_editing",
  "extra_revision",
  "presenter_fee",
  "travel",
  "additional_video",
  "additional_social_post",
  "extra_website_page",
  "stock_footage",
  "music_licence",
  "third_party_service",
  "other",
];

export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "cheque", "online", "other"];

/** A quotation can be edited in place only while it is not a closed record. */
export function quotationEditable(status: string) {
  return status === "draft" || status === "sent" || status === "awaiting_response";
}

/** Scope bullet list, preferring the document's own editable inclusions. */
export function scopeLines(
  inclusions: string[] | null | undefined,
  snap: PackageSnapshot | null | undefined,
  description?: string | null,
): string[] {
  const own = (inclusions ?? []).filter(Boolean);
  const base = own.length > 0 ? own : (snap?.inclusions ?? []).filter(Boolean);
  return [
    ...(description ? [description] : snap?.scope ? [snap.scope] : []),
    ...base,
    ...(snap?.deliverables ? [`Deliverables: ${snap.deliverables}`] : []),
    ...(snap?.duration_note ? [`Duration: ${snap.duration_note}`] : []),
    ...(snap?.revisions != null ? [`Included revisions: ${snap.revisions}`] : []),
    ...(snap?.exclusions ? [`Excludes: ${snap.exclusions}`] : []),
  ];
}

/* -------------------------------------------------------------- snapshots */

export async function customerSnapshot(customerId: string): Promise<CustomerSnapshot | null> {
  const row = await selectOne<CustomerSnapshot & { id: string }>(
    "customers",
    customerId,
    "id, customer_no, name, company, address, phone, email",
  );
  return row ?? null;
}

/* ---------------------------------------------------------- calculations */

/** Recalculate a quotation from its line items, including the advance split. */
export async function recalcQuotation(quotationId: string, advancePercentInput?: number) {
  const items = await selectAll<LineRow>("quotation_items", {
    eq: { quotation_id: quotationId },
  });
  const current = await selectOne<{ advance_percent: number }>(
    "quotations",
    quotationId,
    "advance_percent",
  );
  const percent = advancePercentInput ?? Number(current?.advance_percent ?? 50);
  const totals = documentTotals(items);
  const split = splitAdvance(totals.grand_total, percent);
  await updateRow("quotations", quotationId, {
    ...totals,
    advance_percent: percent,
    advance_amount: split.advance,
    balance_amount: split.balance,
  });
  return { ...totals, advance_percent: percent, ...split };
}

/**
 * Final invoice total:
 *   quotation/line items + approved additional costs − adjustments
 * Balance due deducts every payment already received (advance included).
 */
export async function recalcInvoice(invoiceId: string) {
  const [items, extras, inv] = await Promise.all([
    selectAll<LineRow>("invoice_items", { eq: { invoice_id: invoiceId } }),
    selectAll<AdditionalCost>("invoice_additional_costs", { eq: { invoice_id: invoiceId } }),
    selectOne<{ adjustment_total: number; paid_total: number }>(
      "invoices",
      invoiceId,
      "adjustment_total, paid_total",
    ),
  ]);

  const totals = documentTotals(items);
  const approved = extras
    .filter((e) => e.approval_status === "approved")
    .reduce((sum, e) => sum.plus(d(e.amount)), d(0));
  const adjustment = d(inv?.adjustment_total ?? 0);
  const grand = round(d(totals.grand_total).plus(approved).minus(adjustment)).toNumber();

  const payments = await selectAll<{ amount: number }>("payments", {
    eq: { invoice_id: invoiceId },
    select: "amount",
  });
  const paid = round(payments.reduce((s, p) => s.plus(d(p.amount)), d(0))).toNumber();

  await updateRow("invoices", invoiceId, {
    ...totals,
    additional_total: round(approved).toNumber(),
    grand_total: grand,
    paid_total: paid,
    balance: round(d(grand).minus(d(paid))).toNumber(),
  });

  return {
    ...totals,
    additional_total: round(approved).toNumber(),
    adjustment_total: round(adjustment).toNumber(),
    grand_total: grand,
    paid_total: paid,
    balance: round(d(grand).minus(d(paid))).toNumber(),
  };
}

export function advanceState(required: number, received: number) {
  const req = d(required);
  const got = d(received);
  if (got.lte(0)) return "advance_pending";
  if (got.gte(req)) return "advance_paid";
  return "advance_partially_paid";
}

/* -------------------------------------------------------- version history */

const VERSIONED_FIELDS = [
  "title",
  "issue_date",
  "valid_until",
  "customer_id",
  "package_id",
  "package_description",
  "inclusions",
  "notes",
  "bank_details",
  "terms_text",
  "payment_instructions",
  "advance_percent",
  "subtotal",
  "discount_total",
  "tax_total",
  "grand_total",
  "status",
] as const;

function pick(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of VERSIONED_FIELDS) out[key] = row[key] ?? null;
  return out;
}

/** Store a before/after snapshot of a quotation edit and bump its version. */
export async function recordQuotationVersion(
  quotation: Record<string, unknown> & { id: string; version?: number },
  nextValues: Record<string, unknown>,
  reason?: string | null,
) {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  const version = Number(quotation.version ?? 1);
  await insertRow("quotation_versions", {
    quotation_id: quotation.id,
    version,
    previous: pick(quotation),
    updated: pick({ ...quotation, ...nextValues }),
    reason: reason ?? null,
    changed_by: auth.user?.id ?? null,
  });
  return version + 1;
}

/* --------------------------------------------------- quotation lifecycle */

async function copyQuotationItems(fromId: string, toId: string) {
  const items = await selectAll<Record<string, unknown>>("quotation_items", {
    eq: { quotation_id: fromId },
    order: { column: "position", ascending: true },
  });
  for (const it of items) {
    await insertRow("quotation_items", {
      quotation_id: toId,
      package_id: it["package_id"] ?? null,
      package_snapshot: it["package_snapshot"] ?? null,
      description: it["description"],
      quantity: it["quantity"],
      unit_price: it["unit_price"],
      discount: it["discount"],
      tax_rate: it["tax_rate"],
      line_total: it["line_total"],
      position: it["position"],
    });
  }
}

/**
 * Copy a quotation into a new draft. `revision` keeps the original as the
 * parent and marks it Revised so the accepted record is never overwritten.
 */
export async function copyQuotation(
  source: Quotation,
  opts: { revision: boolean; reason?: string | null },
) {
  const number = await nextNumber("quotation");
  const created = await insertRow<{ id: string }>("quotations", {
    number,
    customer_id: source.customer_id,
    package_id: source.package_id,
    package_snapshot: source.package_snapshot,
    customer_snapshot: source.customer_snapshot,
    package_description: source.package_description,
    inclusions: source.inclusions ?? [],
    title: source.title,
    issue_date: new Date().toISOString().slice(0, 10),
    valid_until: source.valid_until,
    notes: source.notes,
    bank_details: source.bank_details,
    terms_text: source.terms_text,
    payment_instructions: source.payment_instructions,
    status: "draft",
    advance_percent: source.advance_percent,
    subtotal: source.subtotal,
    discount_total: source.discount_total,
    tax_total: source.tax_total,
    grand_total: source.grand_total,
    advance_amount: source.advance_amount,
    balance_amount: source.balance_amount,
    locked: false,
    version: 1,
    ...(opts.revision
      ? { revision_of: source.id, amendment_reason: opts.reason ?? null }
      : {}),
  });

  await copyQuotationItems(source.id, created.id);
  await recalcQuotation(created.id, Number(source.advance_percent ?? 50));

  if (opts.revision) {
    await updateRow("quotations", source.id, { status: "revised" });
    await logActivity("quotation", source.id, "revised", { revision_id: created.id, number });
  } else {
    await logActivity("quotation", source.id, "duplicated", { copy_id: created.id, number });
  }
  return { id: created.id, number };
}

/* ------------------------------------------------- quotation → invoice */

export async function findFinalInvoice(quotationId: string) {
  const rows = await selectAll<{ id: string; number: string; status: string }>("invoices", {
    eq: { quotation_id: quotationId },
    select: "id, number, status",
    order: { column: "created_at", ascending: false },
  });
  return rows.find((r) => r.status !== "void") ?? null;
}

/**
 * Create an editable final-invoice draft from a quotation. Every quotation
 * detail is copied across; the quotation itself is never modified apart from
 * the back-link, and its advance payments are attached to the new invoice.
 */
export async function createFinalInvoiceFromQuotation(quotation: Quotation) {
  if (!quotation.customer_id) throw new Error("Attach a customer before invoicing.");

  const existing = await findFinalInvoice(quotation.id);
  if (existing) return { id: existing.id, number: existing.number, existed: true };

  const sb = getSupabase();
  const snapshot = quotation.customer_snapshot ?? (await customerSnapshot(quotation.customer_id));
  const settings = (
    await selectAll<{ bank_details: string | null; invoice_terms: string | null; payment_instructions: string | null }>(
      "settings",
      { select: "bank_details, invoice_terms, payment_instructions", limit: 1 },
    )
  )[0];

  const number = await nextNumber("invoice");
  const invoice = await insertRow<{ id: string }>("invoices", {
    number,
    customer_id: quotation.customer_id,
    project_id: quotation.project_id,
    quotation_id: quotation.id,
    doc_kind: "final",
    status: "draft",
    issue_date: new Date().toISOString().slice(0, 10),
    milestone_label: `Final invoice — ref ${quotation.number}`,
    quotation_snapshot: {
      number: quotation.number,
      issue_date: quotation.issue_date,
      title: quotation.title,
      grand_total: Number(quotation.grand_total),
      advance_percent: Number(quotation.advance_percent),
      advance_amount: Number(quotation.advance_amount),
      package_snapshot: quotation.package_snapshot,
    },
    package_id: quotation.package_id,
    package_snapshot: quotation.package_snapshot,
    customer_snapshot: snapshot,
    package_description: quotation.package_description,
    inclusions: quotation.inclusions ?? [],
    notes: quotation.notes,
    bank_details: quotation.bank_details ?? settings?.bank_details ?? null,
    terms_text: quotation.terms_text ?? settings?.invoice_terms ?? null,
    payment_instructions: quotation.payment_instructions ?? settings?.payment_instructions ?? null,
    subtotal: quotation.subtotal,
    discount_total: quotation.discount_total,
    tax_total: quotation.tax_total,
    grand_total: quotation.grand_total,
    quotation_total: quotation.grand_total,
    advance_expected: quotation.advance_amount,
    balance: quotation.grand_total,
  });

  const items = await selectAll<Record<string, unknown>>("quotation_items", {
    eq: { quotation_id: quotation.id },
    order: { column: "position", ascending: true },
  });
  for (const it of items) {
    await insertRow("invoice_items", {
      invoice_id: invoice.id,
      package_id: it["package_id"] ?? null,
      package_snapshot: it["package_snapshot"] ?? null,
      description: it["description"],
      quantity: it["quantity"],
      unit_price: it["unit_price"],
      discount: it["discount"],
      tax_rate: it["tax_rate"],
      line_total: it["line_total"],
      position: it["position"],
    });
  }

  // Attach advance payments already recorded against the quotation.
  const { error: payErr } = await sb
    .from("payments")
    .update({ invoice_id: invoice.id })
    .eq("quotation_id", quotation.id)
    .is("invoice_id", null);
  if (payErr) throw new Error(payErr.message);

  await updateRow("quotations", quotation.id, { invoice_id: invoice.id });
  await recalcInvoice(invoice.id);
  await logActivity("quotation", quotation.id, "final invoice created", {
    invoice_id: invoice.id,
    number,
  });
  return { id: invoice.id, number, existed: false };
}

/** Copy an issued invoice into a new editable draft, keeping the original. */
export async function reviseInvoice(inv: Invoice, reason?: string | null) {
  const number = await nextNumber("invoice");
  const created = await insertRow<{ id: string }>("invoices", {
    number,
    customer_id: inv.customer_id,
    project_id: inv.project_id,
    quotation_id: inv.quotation_id,
    doc_kind: inv.doc_kind,
    status: "draft",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: inv.due_date,
    milestone_label: inv.milestone_label,
    quotation_snapshot: inv.quotation_snapshot,
    package_snapshot: inv.package_snapshot,
    customer_snapshot: inv.customer_snapshot,
    package_description: inv.package_description,
    inclusions: inv.inclusions ?? [],
    notes: inv.notes,
    bank_details: inv.bank_details,
    terms_text: inv.terms_text,
    payment_instructions: inv.payment_instructions,
    quotation_total: inv.quotation_total,
    adjustment_total: inv.adjustment_total,
    adjustment_note: inv.adjustment_note,
    advance_expected: inv.advance_expected,
    revision_of: inv.id,
    version: Number(inv.version ?? 1) + 1,
    amendment_reason: reason ?? null,
  });

  const items = await selectAll<Record<string, unknown>>("invoice_items", {
    eq: { invoice_id: inv.id },
    order: { column: "position", ascending: true },
  });
  for (const it of items) {
    await insertRow("invoice_items", {
      invoice_id: created.id,
      package_id: it["package_id"] ?? null,
      description: it["description"],
      quantity: it["quantity"],
      unit_price: it["unit_price"],
      discount: it["discount"],
      tax_rate: it["tax_rate"],
      line_total: it["line_total"],
      position: it["position"],
    });
  }
  const extras = await selectAll<AdditionalCost>("invoice_additional_costs", {
    eq: { invoice_id: inv.id },
  });
  for (const c of extras) {
    await insertRow("invoice_additional_costs", {
      invoice_id: created.id,
      description: c.description,
      cost_type: c.cost_type,
      quantity: c.quantity,
      unit_price: c.unit_price,
      amount: c.amount,
      reason: c.reason,
      notes: c.notes,
      approval_status: c.approval_status,
    });
  }

  await updateRow("invoices", inv.id, { status: "revised" });
  await recalcInvoice(created.id);
  await logActivity("invoice", inv.id, "revised", { revision_id: created.id, number });
  return { id: created.id, number };
}
