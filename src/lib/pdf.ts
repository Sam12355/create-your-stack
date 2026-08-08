import vybeLogo from "@/assets/vybe-logo.png.asset.json";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { selectAll } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";

export type PdfLine = {
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
  position?: number;
};

export type PdfParty = {
  name?: string | null;
  company?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type PdfDoc = {
  kind: "Quotation" | "Invoice" | "Receipt";
  /** Big heading printed top-right, e.g. "FINAL INVOICE". Defaults to kind. */
  heading?: string;
  number: string;
  title?: string | null;
  issue_date: string;
  secondary_label?: string;
  secondary_date?: string | null;
  /** "Ref: VYBE-QUO-2026-0001 · 12 Mar 2026" style reference line. */
  reference?: string | null;
  customer?: PdfParty | undefined;
  items: PdfLine[];
  subtotal: number;
  discount_total?: number;
  tax_total: number;
  grand_total: number;
  paid_total?: number;
  balance?: number;
  notes?: string | null;
  extraRows?: Array<[string, string]>;
  /** Additional-cost rows printed as a second table under the line items. */
  additionalRows?: Array<[string, string, string, string]>;
  /** Scope / inclusions frozen on the document at issue time. */
  scope?: string[];
  /** Advance payment split printed under the totals. */
  advance?: { percent: number; amount: number; balance: number } | undefined;
  /** Extra terms printed above the settings terms (already snapshotted). */
  terms?: string | null;
  /** Document-level overrides for the settings defaults. */
  bank_details?: string | null;
  payment_instructions?: string | null;
  payment_status?: string | null;
  /** Print the signature line at the end of the document. */
  signature?: boolean;
};


type Settings = {
  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_number: string | null;
  bank_details: string | null;
  invoice_terms: string | null;
  quotation_terms: string | null;
  advance_term: string | null;
  payment_instructions: string | null;
  signature_label: string | null;
  footer_text: string | null;
  brand_primary: string | null;
};

const MARGIN = 40;

/** #RRGGBB → [r,g,b] for jsPDF, falling back to the VYBE purple. */
function rgb(hex?: string | null): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m || !m[1]) return [109, 40, 217];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function loadSettings(): Promise<Settings | null> {
  try {
    const rows = await selectAll<Settings>("settings");
    return rows[0] ?? null;
  } catch {
    return null;
  }
}


const LOGO_SIZE = 54;

let logoDataUrl: string | null | undefined;

async function loadLogo(): Promise<string | null> {
  if (logoDataUrl !== undefined) return logoDataUrl;
  try {
    const res = await fetch(vybeLogo.url);
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("logo read failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    logoDataUrl = null;
  }
  return logoDataUrl;
}

/** Build a branded A4 PDF for a quotation, invoice or receipt and trigger a download. */
export async function downloadDocumentPdf(doc: PdfDoc): Promise<void> {
  const [settings, logo] = await Promise.all([loadSettings(), loadLogo()]);
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  let y = MARGIN;

  // Business header
  const textX = logo ? MARGIN + LOGO_SIZE + 12 : MARGIN;
  if (logo) {
    pdf.addImage(logo, "PNG", MARGIN, y - 12, LOGO_SIZE, LOGO_SIZE);
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(settings?.business_name ?? "VYBE Creative Media", textX, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  const contact = [
    settings?.address,
    [settings?.phone, settings?.email].filter(Boolean).join(" · "),
    settings?.website,
    settings?.tax_number ? `Tax No: ${settings.tax_number}` : null,
  ].filter(Boolean) as string[];
  let cy = y + 14;
  for (const line of contact) {
    for (const wrapped of pdf.splitTextToSize(line, 230) as string[]) {
      pdf.text(wrapped, textX, cy);
      cy += 11;
    }
  }
  cy = Math.max(cy, y + LOGO_SIZE - 6);

  // Document title block (right)
  const brand = rgb(settings?.brand_primary);
  const heading = (doc.heading ?? doc.kind).toUpperCase();
  pdf.setTextColor(brand[0], brand[1], brand[2]);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(heading.length > 12 ? 16 : 20);
  pdf.text(heading, pageWidth - MARGIN, y, { align: "right" });
  pdf.setTextColor(20);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(doc.number, pageWidth - MARGIN, y + 16, { align: "right" });
  pdf.setTextColor(110);
  pdf.setFontSize(9);
  pdf.text(`Date: ${formatDate(doc.issue_date)}`, pageWidth - MARGIN, y + 30, { align: "right" });
  let ry = y + 42;
  if (doc.secondary_date) {
    pdf.text(
      `${doc.secondary_label ?? "Valid until"}: ${formatDate(doc.secondary_date)}`,
      pageWidth - MARGIN,
      ry,
      { align: "right" },
    );
    ry += 12;
  }
  if (doc.reference) {
    pdf.text(doc.reference, pageWidth - MARGIN, ry, { align: "right" });
    ry += 12;
  }
  if (doc.payment_status) {
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(brand[0], brand[1], brand[2]);
    pdf.text(doc.payment_status, pageWidth - MARGIN, ry, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(110);
    ry += 12;
  }

  y = Math.max(cy, ry, y + 56) + 12;
  pdf.setDrawColor(brand[0], brand[1], brand[2]);
  pdf.setLineWidth(1.4);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  pdf.setLineWidth(0.5);
  y += 20;


  // Bill to
  pdf.setTextColor(110);
  pdf.setFontSize(9);
  pdf.text("BILL TO", MARGIN, y);
  pdf.setTextColor(20);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(doc.customer?.name ?? "—", MARGIN, y + 15);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  let by = y + 29;
  const party = [
    doc.customer?.company,
    doc.customer?.address,
    [doc.customer?.phone, doc.customer?.email].filter(Boolean).join(" · "),
  ].filter(Boolean) as string[];
  for (const line of party) {
    for (const wrapped of pdf.splitTextToSize(line, 260) as string[]) {
      pdf.text(wrapped, MARGIN, by);
      by += 11;
    }
  }

  if (doc.title) {
    pdf.setTextColor(20);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(doc.title, pageWidth - MARGIN, y + 15, { align: "right" });
    pdf.setFont("helvetica", "normal");
  }

  y = by + 16;

  // Scope / inclusions snapshot
  if (doc.scope && doc.scope.length > 0) {
    pdf.setTextColor(110);
    pdf.setFontSize(9);
    pdf.text("SCOPE & INCLUSIONS", MARGIN, y);
    y += 13;
    pdf.setTextColor(60);
    for (const item of doc.scope) {
      for (const wrapped of pdf.splitTextToSize(`•  ${item}`, pageWidth - MARGIN * 2) as string[]) {
        pdf.text(wrapped, MARGIN, y);
        y += 11;
      }
    }
    y += 8;
  }

  // Line items
  const items = [...doc.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  autoTable(pdf, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", "Description", "Qty", "Unit price", "Disc.", "Tax %", "Amount"]],
    body: items.map((it, i) => [
      String(i + 1),
      it.description || "—",
      String(it.quantity),
      formatMoney(it.unit_price),
      it.discount ? formatMoney(it.discount) : "—",
      it.tax_rate ? `${it.tax_rate}` : "—",
      formatMoney(it.line_total),
    ]),
    styles: { fontSize: 9, cellPadding: 6, textColor: 30, lineColor: 225, lineWidth: 0.5 },
    headStyles: { fillColor: [244, 246, 250], textColor: 60, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 24 },
      2: { halign: "right", cellWidth: 44 },
      3: { halign: "right", cellWidth: 76 },
      4: { halign: "right", cellWidth: 60 },
      5: { halign: "right", cellWidth: 46 },
      6: { halign: "right", cellWidth: 84 },
    },
  });

  let afterTable =
    (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  // Additional costs (approved extras added during the project)
  if (doc.additionalRows && doc.additionalRows.length > 0) {
    autoTable(pdf, {
      startY: afterTable + 16,
      margin: { left: MARGIN, right: MARGIN },
      head: [["Additional cost", "Qty", "Unit price", "Amount"]],
      body: doc.additionalRows.map((r) => [...r]),
      styles: { fontSize: 9, cellPadding: 6, textColor: 30, lineColor: 225, lineWidth: 0.5 },
      headStyles: { fillColor: [244, 246, 250], textColor: 60, fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right", cellWidth: 44 },
        2: { halign: "right", cellWidth: 76 },
        3: { halign: "right", cellWidth: 84 },
      },
    });
    afterTable =
      (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      afterTable;
  }

  let ty = afterTable + 18;


  // Totals
  const totals: Array<[string, string]> = [["Subtotal", formatMoney(doc.subtotal)]];
  if (doc.discount_total) totals.push(["Discount", `- ${formatMoney(doc.discount_total)}`]);
  if (doc.tax_total) totals.push(["Tax", formatMoney(doc.tax_total)]);
  totals.push(["Total", formatMoney(doc.grand_total)]);
  if (doc.advance) {
    totals.push([`Advance (${doc.advance.percent}%)`, formatMoney(doc.advance.amount)]);
    totals.push(["Balance on delivery", formatMoney(doc.advance.balance)]);
  }
  if (doc.paid_total !== undefined) totals.push(["Paid", formatMoney(doc.paid_total)]);
  if (doc.balance !== undefined) totals.push(["Balance due", formatMoney(doc.balance)]);
  for (const row of doc.extraRows ?? []) totals.push(row);

  const labelX = pageWidth - MARGIN - 190;
  const valueX = pageWidth - MARGIN;
  pdf.setFontSize(10);
  for (const [label, value] of totals) {
    const strong = label === "Total" || label === "Balance due";
    pdf.setFont("helvetica", strong ? "bold" : "normal");
    pdf.setTextColor(strong ? 20 : 110);
    pdf.text(label, labelX, ty);
    pdf.setTextColor(20);
    pdf.text(value, valueX, ty, { align: "right" });
    ty += strong ? 18 : 15;
  }

  // Notes, bank details, terms
  let ny = Math.max(ty + 10, afterTable + 18);
  const block = (heading: string, text?: string | null) => {
    if (!text) return;
    if (ny > pdf.internal.pageSize.getHeight() - 120) {
      pdf.addPage();
      ny = MARGIN;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(20);
    pdf.text(heading, MARGIN, ny);
    ny += 13;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(90);
    for (const line of pdf.splitTextToSize(text, pageWidth - MARGIN * 2) as string[]) {
      pdf.text(line, MARGIN, ny);
      ny += 11;
    }
    ny += 10;
  };

  block("Notes", doc.notes);
  block("Payment terms", settings?.advance_term);
  block("Payment instructions", doc.payment_instructions ?? settings?.payment_instructions);
  block("Bank details", doc.bank_details ?? settings?.bank_details);
  block(
    "Terms & conditions",
    doc.terms ?? (doc.kind === "Quotation" ? settings?.quotation_terms : settings?.invoice_terms),
  );


  if (doc.signature !== false) {
    if (ny > pdf.internal.pageSize.getHeight() - 110) {
      pdf.addPage();
      ny = MARGIN;
    }
    ny += 24;
    pdf.setDrawColor(180);
    pdf.line(MARGIN, ny, MARGIN + 180, ny);
    pdf.line(pageWidth - MARGIN - 180, ny, pageWidth - MARGIN, ny);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110);
    pdf.text(settings?.signature_label ?? "Authorised Signature", MARGIN, ny + 12);
    pdf.text("Client acceptance (name, signature & date)", pageWidth - MARGIN, ny + 12, {
      align: "right",
    });
  }


  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(
      [settings?.business_name ?? "VYBE Creative Media", settings?.footer_text, doc.number, `Page ${p} of ${pages}`]
        .filter(Boolean)
        .join(" · "),
      pageWidth / 2,
      pdf.internal.pageSize.getHeight() - 24,
      { align: "center" },
    );
  }

  pdf.save(`${(doc.heading ?? doc.kind).replace(/\s+/g, "-")}-${doc.number}.pdf`);
}
