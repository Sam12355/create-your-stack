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
  number: string;
  title?: string | null;
  issue_date: string;
  secondary_label?: string;
  secondary_date?: string | null;
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
};

const MARGIN = 40;

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
  pdf.setTextColor(20);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text(doc.kind.toUpperCase(), pageWidth - MARGIN, y, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(doc.number, pageWidth - MARGIN, y + 16, { align: "right" });
  pdf.setTextColor(110);
  pdf.setFontSize(9);
  pdf.text(`Date: ${formatDate(doc.issue_date)}`, pageWidth - MARGIN, y + 30, { align: "right" });
  if (doc.secondary_date) {
    pdf.text(
      `${doc.secondary_label ?? "Valid until"}: ${formatDate(doc.secondary_date)}`,
      pageWidth - MARGIN,
      y + 42,
      { align: "right" },
    );
  }

  y = Math.max(cy, y + 56) + 12;
  pdf.setDrawColor(220);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
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

  const afterTable =
    (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let ty = afterTable + 18;

  // Totals
  const totals: Array<[string, string]> = [["Subtotal", formatMoney(doc.subtotal)]];
  if (doc.discount_total) totals.push(["Discount", `- ${formatMoney(doc.discount_total)}`]);
  if (doc.tax_total) totals.push(["Tax", formatMoney(doc.tax_total)]);
  totals.push(["Total", formatMoney(doc.grand_total)]);
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
  if (doc.kind !== "Quotation") block("Bank details", settings?.bank_details);
  block("Terms & conditions", settings?.invoice_terms);

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(
      `${settings?.business_name ?? "VYBE Creative Media"} · ${doc.number} · Page ${p} of ${pages}`,
      pageWidth / 2,
      pdf.internal.pageSize.getHeight() - 24,
      { align: "center" },
    );
  }

  pdf.save(`${doc.kind}-${doc.number}.pdf`);
}
