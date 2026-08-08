import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { useList, useSaveRow } from "@/lib/api";
import { formatDateTime } from "@/lib/money";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { ErrorNote, Loading, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — VYBE Business System" },
      { name: "description", content: "Shoots, studio bookings, meetings and deliveries." },
    ],
  }),
  component: CalendarPage,
});

type Event = {
  id: string;
  title: string;
  event_type: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  resource: string | null;
  status: string;
  project_id: string | null;
  customer_id: string | null;
};

const TYPES = ["shoot", "studio_booking", "meeting", "delivery", "payment_due", "reminder", "other"];

function CalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const events = useList<Event>("calendar_events", {
    order: { column: "starts_at", ascending: true },
  });
  const projects = useList<{ id: string; title: string }>("projects");
  const customers = useList<{ id: string; name: string }>("customers");
  const save = useSaveRow("calendar_events");

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }, [cursor]);

  if (events.isLoading) return <Loading />;
  if (events.error) return <ErrorNote error={events.error} />;

  const byDay = (day: Date) =>
    (events.data ?? []).filter(
      (e) => new Date(e.starts_at).toDateString() === day.toDateString(),
    );

  const fields: Field[] = [
    { name: "title", label: "Title", required: true },
    {
      name: "event_type",
      label: "Type",
      type: "select",
      required: true,
      options: TYPES.map((t) => ({ value: t, label: humanize(t) })),
    },
    { name: "starts_at", label: "Starts", type: "datetime", required: true },
    { name: "ends_at", label: "Ends", type: "datetime", required: true },
    { name: "location", label: "Location" },
    { name: "resource", label: "Resource", placeholder: "Studio A, Camera kit 1" },
    {
      name: "project_id",
      label: "Project",
      type: "select",
      options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.title })),
    },
    {
      name: "customer_id",
      label: "Customer",
      type: "select",
      options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: ["scheduled", "confirmed", "completed", "cancelled"].map((s) => ({
        value: s,
        label: humanize(s),
      })),
    },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  const monthLabel = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Bookings and deadlines. Double-booking the same resource is blocked."
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous month"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-40 text-center text-sm font-medium">{monthLabel}</span>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next month"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> New event
            </Button>
          </>
        }
      />

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-xs font-medium">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="p-2 text-center text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((day) => {
            const items = byDay(day);
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-24 border-b border-r border-border p-1.5 text-xs",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full tabular",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {items.map((e) => (
                    <button
                      key={e.id}
                      className="block w-full truncate rounded bg-accent px-1.5 py-1 text-left text-[11px] hover:bg-accent/70"
                      onClick={() => {
                        setEditing(e);
                        setOpen(true);
                      }}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-sm font-semibold">Upcoming</p>
        {(events.data ?? [])
          .filter((e) => new Date(e.starts_at) >= new Date())
          .slice(0, 8)
          .map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span className="font-medium">{e.title}</span>
              <span className="flex items-center gap-2">
                {e.resource ? (
                  <span className="text-xs text-muted-foreground">{e.resource}</span>
                ) : null}
                <StatusBadge value={e.event_type} />
                <span className="text-xs text-muted-foreground">{formatDateTime(e.starts_at)}</span>
              </span>
            </div>
          ))}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Edit event" : "New event"}
        fields={fields}
        initial={editing ?? { event_type: "shoot", status: "scheduled" }}
        saving={save.isPending}
        onSubmit={async (values) => {
          try {
            await save.mutateAsync({ ...(editing ? { id: editing.id } : {}), values });
            setOpen(false);
            toast.success("Event saved.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save event");
          }
        }}
      />
    </div>
  );
}
