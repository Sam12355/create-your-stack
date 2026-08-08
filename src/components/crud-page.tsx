import { useMemo, useState, type ReactNode } from "react";
import { Plus, Search, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useList, useSaveRow, useDeleteRow, type Row } from "@/lib/api";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field, type Values } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Column<T> = {
  key: string;
  header: string;
  cell?: (row: T) => ReactNode;
  className?: string;
};

export function CrudPage<T extends { id: string }>({
  table,
  title,
  description,
  columns,
  fields,
  defaults,
  order,
  searchKeys,
  addLabel,
  rowActions,
  toolbar,
  transform,
  afterSave,
}: {
  table: string;
  title: string;
  description?: string;
  columns: Column<T>[];
  fields: Field[];
  defaults?: Values;
  order?: { column: string; ascending?: boolean };
  searchKeys?: (keyof T & string)[];
  addLabel?: string;
  rowActions?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  transform?: (values: Values) => Row;
  afterSave?: (row: Row, values: Values, isNew: boolean) => Promise<void> | void;
}) {
  const listOpts = order ? { order } : {};
  const { data, isLoading, error } = useList<T>(table, listOpts);
  const save = useSaveRow(table);
  const remove = useDeleteRow(table);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = data ?? [];
    if (!query.trim() || !searchKeys?.length) return all;
    const q = query.toLowerCase();
    return all.filter((r) =>
      searchKeys.some((k) => String((r as Row)[k] ?? "").toLowerCase().includes(q)),
    );
  }, [data, query, searchKeys]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  return (
    <div>
      <PageHeader
        title={title}
        {...(description ? { description } : {})}
        actions={
          <>
            {toolbar}
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> {addLabel ?? "New"}
            </Button>
          </>
        }
      />

      {searchKeys?.length ? (
        <div className="relative mb-3 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.header}
                </TableHead>
              ))}
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.cell ? c.cell(row) : String((row as Row)[c.key] ?? "—")}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {rowActions?.(row)}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Edit"
                      onClick={() => {
                        setEditing(row);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      aria-label="Delete"
                      onClick={async () => {
                        if (!confirm("Delete this record permanently?")) return;
                        try {
                          await remove.mutateAsync(row.id);
                          toast.success("Deleted.");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Delete failed");
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No records yet" description="Create the first one to get started." />
          </div>
        ) : null}
      </div>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${title.replace(/s$/, "").toLowerCase()}` : (addLabel ?? "New record")}
        fields={fields}
        initial={editing ?? defaults ?? {}}
        saving={save.isPending}
        onSubmit={async (values) => {
          try {
            const saved = (await save.mutateAsync({
              ...(editing ? { id: editing.id } : {}),
              values: transform ? transform(values) : (values as Row),
            })) as Row;
            setOpen(false);
            toast.success("Saved.");
            await afterSave?.(saved, values, !editing);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Save failed");
          }
        }}
      />
    </div>
  );
}
