import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRow, insertRow, updateRow, useList, type Row } from "@/lib/api";
import { documentTotals, formatMoney, lineTotal } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type LineItem = {
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

type Pkg = {
  id: string;
  name: string;
  base_price: number;
  tax_rate: number;
  short_description: string | null;
};

export function LineItems({
  table,
  parentTable,
  parentKey,
  parentId,
  locked,
  onChanged,
}: {
  table: "quotation_items" | "invoice_items";
  parentTable: "quotations" | "invoices";
  parentKey: "quotation_id" | "invoice_id";
  parentId: string;
  locked?: boolean;
  /** Called after any add / edit / remove so the parent can recalculate. */
  onChanged?: () => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const items = useList<LineItem>(table, {
    eq: { [parentKey]: parentId },
    order: { column: "position", ascending: true },
  });
  const packages = useList<Pkg>("packages", {
    eq: { is_active: true },
    order: { column: "name", ascending: true },
  });
  const [busy, setBusy] = useState(false);

  const rows = items.data ?? [];
  const totals = documentTotals(rows);

  const refresh = async () => {
    await onChanged?.();
    await qc.invalidateQueries({ queryKey: [table] });
    await qc.invalidateQueries({ queryKey: [parentTable] });
  };


  const pushTotals = async (next: LineItem[]) => {
    const t = documentTotals(next);
    await updateRow(parentTable, parentId, {
      subtotal: t.subtotal,
      discount_total: t.discount_total,
      tax_total: t.tax_total,
      grand_total: t.grand_total,
    });
  };

  const addItem = async (values: Partial<LineItem>) => {
    setBusy(true);
    try {
      const item = {
        [parentKey]: parentId,
        description: values.description ?? "New item",
        quantity: values.quantity ?? 1,
        unit_price: values.unit_price ?? 0,
        discount: values.discount ?? 0,
        tax_rate: values.tax_rate ?? 0,
        position: rows.length,
        package_id: values.package_id ?? null,
        line_total: lineTotal({
          quantity: values.quantity ?? 1,
          unit_price: values.unit_price ?? 0,
          discount: values.discount ?? 0,
          tax_rate: values.tax_rate ?? 0,
        }).total.toNumber(),
      } as Row;
      const created = await insertRow<LineItem>(table, item);
      await pushTotals([...rows, created]);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add item");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (row: LineItem, changes: Partial<LineItem>) => {
    const merged = { ...row, ...changes };
    merged.line_total = lineTotal(merged).total.toNumber();
    await updateRow(table, row.id, {
      description: merged.description,
      quantity: merged.quantity,
      unit_price: merged.unit_price,
      discount: merged.discount,
      tax_rate: merged.tax_rate,
      line_total: merged.line_total,
    });
    await pushTotals(rows.map((r) => (r.id === row.id ? merged : r)));
    await refresh();
  };

  const drop = async (row: LineItem) => {
    if (!confirm(`Remove line item "${row.description}"?`)) return;
    await deleteRow(table, row.id);
    await pushTotals(rows.filter((r) => r.id !== row.id));
    await refresh();
  };


  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <p className="text-sm font-semibold">Line items</p>
        {!locked ? (
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(id) => {
                const p = (packages.data ?? []).find((x) => x.id === id);
                if (!p) return;
                void addItem({
                  description: p.short_description ? `${p.name} — ${p.short_description}` : p.name,
                  unit_price: Number(p.base_price),
                  tax_rate: Number(p.tax_rate),
                  package_id: p.id,
                });
              }}
            >
              <SelectTrigger className="w-56" aria-label="Add package">
                <SelectValue placeholder="Add from catalogue…" />
              </SelectTrigger>
              <SelectContent>
                {(packages.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.base_price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void addItem({})}>
              <Plus className="mr-1.5 h-4 w-4" /> Custom line
            </Button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Description</TableHead>
              <TableHead className="w-24">Qty</TableHead>
              <TableHead className="w-32">Unit price</TableHead>
              <TableHead className="w-28">Discount</TableHead>
              <TableHead className="w-24">Tax %</TableHead>
              <TableHead className="w-32 text-right">Total</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Input
                    defaultValue={row.description}
                    disabled={locked}
                    aria-label="Description"
                    onBlur={(e) =>
                      e.target.value !== row.description &&
                      void patch(row, { description: e.target.value })
                    }
                  />
                </TableCell>
                {(["quantity", "unit_price", "discount", "tax_rate"] as const).map((key) => (
                  <TableCell key={key}>
                    <Input
                      type="number"
                      step="0.01"
                      className="tabular"
                      aria-label={key}
                      disabled={locked}
                      defaultValue={row[key]}
                      onBlur={(e) => {
                        const v = Number(e.target.value || 0);
                        if (v !== Number(row[key])) void patch(row, { [key]: v });
                      }}
                    />
                  </TableCell>
                ))}
                <TableCell className="text-right tabular">{formatMoney(row.line_total)}</TableCell>
                <TableCell>
                  {!locked ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      aria-label="Remove line"
                      onClick={() => void drop(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No line items yet — add one from the catalogue or a custom line.
          </p>
        ) : null}
      </div>

      <div className="flex justify-end border-t border-border p-3">
        <dl className="w-64 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular">{formatMoney(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular">−{formatMoney(totals.discount_total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="tabular">{formatMoney(totals.tax_total)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <dt>Grand total</dt>
            <dd className="tabular">{formatMoney(totals.grand_total)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
