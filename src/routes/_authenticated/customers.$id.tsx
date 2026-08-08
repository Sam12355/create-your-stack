import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useList, useOne } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorNote, Loading, StatCard, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/customers/$id")({
  head: () => ({
    meta: [
      { title: "Customer — VYBE Business System" },
      { name: "description", content: "Customer profile with projects, invoices and history." },
    ],
  }),
  component: CustomerDetail,
});

type Customer = {
  id: string;
  name: string;
  company: string | null;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  customer_type: string;
  notes: string | null;
};

function CustomerDetail() {
  const { id } = Route.useParams();
  const customer = useOne<Customer>("customers", id);
  const projects = useList<{ id: string; code: string; title: string; status: string }>("projects", {
    eq: { customer_id: id },
  });
  const invoices = useList<{
    id: string;
    number: string;
    status: string;
    grand_total: number;
    balance: number;
    issue_date: string;
  }>("invoices", { eq: { customer_id: id } });
  const quotations = useList<{ id: string; number: string; status: string; grand_total: number }>(
    "quotations",
    { eq: { customer_id: id } },
  );

  if (customer.isLoading) return <Loading />;
  if (customer.error) return <ErrorNote error={customer.error} />;
  if (!customer.data) return <ErrorNote error={new Error("Customer not found")} />;

  const c = customer.data;
  const billed = (invoices.data ?? []).reduce((s, i) => s + Number(i.grand_total), 0);
  const due = (invoices.data ?? []).reduce((s, i) => s + Number(i.balance), 0);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/customers">
          <ArrowLeft className="mr-1 h-4 w-4" /> All customers
        </Link>
      </Button>

      <PageHeader
        title={c.name}
        description={[c.company, c.phone, c.email].filter(Boolean).join(" · ")}
        actions={<StatusBadge value={c.customer_type} />}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Projects" value={(projects.data ?? []).length} tone="primary" />
        <StatCard label="Quotations" value={(quotations.data ?? []).length} tone="info" />
        <StatCard label="Billed" value={formatMoney(billed)} tone="success" />
        <StatCard label="Outstanding" value={formatMoney(due)} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contact details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Contact person: </span>
              {c.contact_person || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">WhatsApp: </span>
              {c.whatsapp || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Type: </span>
              {humanize(c.customer_type)}
            </p>
            <p className="whitespace-pre-wrap">
              <span className="text-muted-foreground">Address: </span>
              {c.address || "—"}
            </p>
            {c.notes ? (
              <p className="whitespace-pre-wrap pt-2 text-muted-foreground">{c.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(projects.data ?? []).length === 0 ? (
              <EmptyState title="No projects yet" />
            ) : (
              (projects.data ?? []).map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span>
                    <span className="tabular text-muted-foreground">{p.code}</span> {p.title}
                  </span>
                  <StatusBadge value={p.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quotations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(quotations.data ?? []).length === 0 ? (
              <EmptyState title="No quotations yet" />
            ) : (
              (quotations.data ?? []).map((q) => (
                <Link
                  key={q.id}
                  to="/quotations/$id"
                  params={{ id: q.id }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="tabular">{q.number}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={q.status} />
                    <span className="tabular text-xs">{formatMoney(q.grand_total)}</span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(invoices.data ?? []).length === 0 ? (
              <EmptyState title="No invoices yet" />
            ) : (
              (invoices.data ?? []).map((i) => (
                <Link
                  key={i.id}
                  to="/invoices/$id"
                  params={{ id: i.id }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="tabular">{i.number}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={i.status} />
                    <span className="text-xs text-muted-foreground">{formatDate(i.issue_date)}</span>
                    <span className="tabular text-xs">{formatMoney(i.grand_total)}</span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
