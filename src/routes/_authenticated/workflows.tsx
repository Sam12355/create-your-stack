import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  useList,
  useSaveRow,
  useDeleteRow,
  insertRow,
  deleteRow,
} from "@/lib/api";
import { PageHeader } from "@/components/app-shell";
import { RecordDialog, type Field } from "@/components/record-dialog";
import { EmptyState, ErrorNote, Loading, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/workflows")({
  head: () => ({
    meta: [
      { title: "Workflows — VYBE Business System" },
      { name: "description", content: "Reusable production workflow templates and their stages." },
    ],
  }),
  component: WorkflowsPage,
});

type Template = { id: string; name: string; description: string | null; is_active: boolean };
type Stage = { id: string; template_id: string; name: string; position: number };

const FIELDS: Field[] = [
  { name: "name", label: "Workflow name", required: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "is_active", label: "Active", type: "switch" },
];

function WorkflowsPage() {
  const qc = useQueryClient();
  const templates = useList<Template>("workflow_templates", {
    order: { column: "name", ascending: true },
  });
  const stages = useList<Stage>("workflow_stages", {
    order: { column: "position", ascending: true },
  });
  const saveTemplate = useSaveRow("workflow_templates");
  const removeTemplate = useDeleteRow("workflow_templates");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [stageDraft, setStageDraft] = useState<Record<string, string>>({});

  if (templates.isLoading || stages.isLoading) return <Loading />;
  if (templates.error) return <ErrorNote error={templates.error} />;

  const addStage = async (templateId: string) => {
    const name = (stageDraft[templateId] ?? "").trim();
    if (!name) return;
    const existing = (stages.data ?? []).filter((s) => s.template_id === templateId);
    await insertRow("workflow_stages", {
      template_id: templateId,
      name,
      position: existing.length,
    });
    setStageDraft((d) => ({ ...d, [templateId]: "" }));
    qc.invalidateQueries({ queryKey: ["workflow_stages"] });
  };

  const dropStage = async (id: string) => {
    await deleteRow("workflow_stages", id);
    qc.invalidateQueries({ queryKey: ["workflow_stages"] });
  };

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Templates that generate the task checklist on every new project."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New workflow
          </Button>
        }
      />

      {(templates.data ?? []).length === 0 ? (
        <EmptyState title="No workflows yet" description="Create your first production template." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(templates.data ?? []).map((t) => {
            const list = (stages.data ?? []).filter((s) => s.template_id === t.id);
            return (
              <Card key={t.id}>
                <CardHeader className="flex-row items-start justify-between gap-2 pb-3">
                  <div>
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    {t.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge value={t.is_active ? "active" : "inactive"} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(t);
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      aria-label="Delete workflow"
                      onClick={async () => {
                        if (!confirm(`Delete workflow "${t.name}"?`)) return;
                        await removeTemplate.mutateAsync(t.id);
                        toast.success("Workflow deleted.");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {list.map((s, i) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                    >
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="w-5 text-xs tabular text-muted-foreground">{i + 1}</span>
                      <span className="flex-1">{s.name}</span>
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove stage"
                        onClick={() => void dropStage(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <form
                    className="flex gap-2 pt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addStage(t.id);
                    }}
                  >
                    <Input
                      value={stageDraft[t.id] ?? ""}
                      placeholder="Add a stage…"
                      onChange={(e) => setStageDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      Add
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Edit workflow" : "New workflow"}
        fields={FIELDS}
        initial={editing ?? { is_active: true }}
        saving={saveTemplate.isPending}
        onSubmit={async (values) => {
          await saveTemplate.mutateAsync({ ...(editing ? { id: editing.id } : {}), values });
          setOpen(false);
          toast.success("Workflow saved.");
        }}
      />
    </div>
  );
}
