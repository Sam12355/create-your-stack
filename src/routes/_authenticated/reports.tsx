import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useList } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { ErrorNote, Loading, StatCard, humanize } from "@/components/ui-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — VYBE Business System" },
      { name: "description", content: "Income, expenses, profit, pipeline and package performance." },
    ],
  }),
  component: ReportsPage,
});

type Invoice = { id: string; customer_id: string; issue_date: string; grand_total: number; paid_total: number; status: string };
type Expense = { id: string; spent_on: string; category: string | null; amount: number };
type Lead = { id: string; stage: string; source: string | null };
type Item = { id: string; description: string; line_total: number; package_id: string | null };
type Customer = { id: string; name: string };

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

function ReportsPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const invoices = useList<Invoice>("invoices");
  const expenses = useList<Expense>("expenses");
  const leads = useList<Lead>("leads");
  const items = useList<Item>("invoice_items");
  const customers = useList<Customer>("customers");

  const inRange = (date: string) => date >= from && date <= to;

  const stats = useMemo(() => {
    const inv = (invoices.data ?? []).filter(
      (i) => inRange(i.issue_date) && i.status !== "void",
    );
    const exp = (expenses.data ?? []).filter((e) => inRange(e.spent_on));
    const income = inv.reduce((s, i) => s + Number(i.paid_total), 0);
    const billed = inv.reduce((s, i) => s + Number(i.grand_total), 0);
    const spend = exp.reduce((s, e) => s + Number(e.amount), 0);

    const byCategory = new Map<string, number>();
    for (const e of exp) {
      const k = e.category ?? "Uncategorised";
      byCategory.set(k, (byCategory.get(k) ?? 0) + Number(e.amount));
    }

    const byCustomer = new Map<string, number>();
    for (const i of inv) {
      byCustomer.set(i.customer_id, (byCustomer.get(i.customer_id) ?? 0) + Number(i.grand_total));
    }

    const byPackage = new Map<string, { count: number; value: number }>();
    for (const it of items.data ?? []) {
      const key = it.description.split("—")[0]?.trim() || "Custom";
      const cur = byPackage.get(key) ?? { count: 0, value: 0 };
      byPackage.set(key, { count: cur.count + 1, value: cur.value + Number(it.line_total) });
    }

    const allLeads = leads.data ?? [];
    const won = allLeads.filter((l) => l.stage === "won").length;

    return {
      income,
      billed,
      spend,
      profit: income - spend,
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
      byCustomer: [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      byPackage: [...byPackage.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 8),
      conversion: allLeads.length ? Math.round((won / allLeads.length) * 100) : 0,
      leadStages: [...new Set(allLeads.map((l) => l.stage))].map((stage) => ({
        stage,
        count: allLeads.filter((l) => l.stage === stage).length,
      })),
    };
  }, [invoices.data, expenses.data, leads.data, items.data, from, to]);

  if (invoices.isLoading || expenses.isLoading) return <Loading />;
  if (invoices.error) return <ErrorNote error={invoices.error} />;

  const customerName = (id: string) => (customers.data ?? []).find((c) => c.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Money in, money out and where the work comes from."
        actions={
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Collected" value={formatMoney(stats.income)} tone="success" />
        <StatCard label="Billed" value={formatMoney(stats.billed)} tone="info" />
        <StatCard label="Expenses" value={formatMoney(stats.spend)} tone="danger" />
        <StatCard
          label="Profit"
          value={formatMoney(stats.profit)}
          hint={`${stats.conversion}% lead conversion`}
          tone="primary"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byCategory.map(([cat, amount]) => (
                  <TableRow key={cat}>
                    <TableCell>{cat}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top customers</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byCustomer.map(([cid, amount]) => (
                  <TableRow key={cid}>
                    <TableCell>{customerName(cid)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Package performance</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byPackage.map(([name, v]) => (
                  <TableRow key={name}>
                    <TableCell>{name}</TableCell>
                    <TableCell className="text-right tabular">{v.count}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(v.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lead pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.leadStages.map((s) => (
                  <TableRow key={s.stage}>
                    <TableCell>{humanize(s.stage)}</TableCell>
                    <TableCell className="text-right tabular">{s.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
