import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Num = number | string | Decimal | null | undefined;

export const d = (v: Num): Decimal => new Decimal(v == null || v === "" ? 0 : (v as never));

/** Round to N decimals using half-up — the single rounding rule for the system. */
export const round = (v: Num, dp = 2): Decimal => d(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

export function lineTotal(input: {
  quantity: Num;
  unit_price: Num;
  discount?: Num;
  tax_rate?: Num;
}) {
  const gross = d(input.quantity).mul(d(input.unit_price));
  const discount = d(input.discount);
  const net = gross.minus(discount);
  const tax = round(net.mul(d(input.tax_rate)).div(100));
  return {
    gross: round(gross),
    discount: round(discount),
    net: round(net),
    tax,
    total: round(net.plus(tax)),
  };
}

export function documentTotals(
  items: Array<{ quantity: Num; unit_price: Num; discount?: Num; tax_rate?: Num }>,
) {
  let subtotal = d(0);
  let discountTotal = d(0);
  let taxTotal = d(0);
  for (const item of items) {
    const l = lineTotal(item);
    subtotal = subtotal.plus(l.gross);
    discountTotal = discountTotal.plus(l.discount);
    taxTotal = taxTotal.plus(l.tax);
  }
  const grand = round(subtotal.minus(discountTotal).plus(taxTotal));
  return {
    subtotal: round(subtotal).toNumber(),
    discount_total: round(discountTotal).toNumber(),
    tax_total: round(taxTotal).toNumber(),
    grand_total: grand.toNumber(),
  };
}

/**
 * Split a total into an advance and a balance so that advance + balance === total
 * exactly, with no lost cents.
 */
export function splitAdvance(total: Num, percent: Num) {
  const t = round(total);
  const advance = round(t.mul(d(percent)).div(100));
  return { advance: advance.toNumber(), balance: t.minus(advance).toNumber() };
}

export function formatMoney(value: Num, currency = "LKR") {
  const n = round(value).toNumber();
  return `${currency} ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Introductory discount: excluded for the Website / Web Development category. */
export function introDiscountFor(pkg: {
  category?: string | null;
  intro_discount_eligible?: boolean | null;
  intro_discount_type?: string | null;
  intro_discount_value?: Num;
  base_price?: Num;
}) {
  const category = (pkg.category ?? "").toLowerCase();
  if (category.includes("website") || category.includes("web development")) return 0;
  if (!pkg.intro_discount_eligible) return 0;
  if (pkg.intro_discount_type === "percent") {
    return round(d(pkg.base_price).mul(d(pkg.intro_discount_value)).div(100)).toNumber();
  }
  return round(pkg.intro_discount_value).toNumber();
}
