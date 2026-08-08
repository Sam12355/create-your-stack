import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { updateRow, useList } from "@/lib/api";
import { formatDateTime } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorNote, Loading, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — VYBE Business System" },
      { name: "description", content: "Reminders for follow-ups, shoots and payment due dates." },
    ],
  }),
  component: NotificationsPage,
});

type Notification = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  due_at: string | null;
  read_at: string | null;
  created_at: string;
};

function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useList<Notification>("notifications", {
    order: { column: "created_at", ascending: false },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const rows = data ?? [];
  const unread = rows.filter((n) => !n.read_at);

  const markAll = async () => {
    for (const n of unread) await updateRow("notifications", n.id, { read_at: new Date().toISOString() });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Follow-up, booking and payment reminders."
        actions={
          unread.length ? (
            <Button variant="outline" onClick={() => void markAll()}>
              <Check className="mr-1.5 h-4 w-4" /> Mark all read
            </Button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to see"
          description="Reminders appear here as follow-ups and due dates approach."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex gap-3">
                <Bell
                  className={`mt-0.5 h-4 w-4 ${n.read_at ? "text-muted-foreground" : "text-primary"}`}
                />
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDateTime(n.due_at ?? n.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={n.kind} />
                {!n.read_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await updateRow("notifications", n.id, { read_at: new Date().toISOString() });
                      qc.invalidateQueries({ queryKey: ["notifications"] });
                    }}
                  >
                    Mark read
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
