import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "textarea"
  | "select"
  | "list"
  | "switch";


export type Field = {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  full?: boolean;
  help?: string;
};

export type Values = Record<string, unknown>;

export function toInputValue(v: unknown, type?: FieldType) {
  if (v == null) return "";
  if (type === "datetime" && typeof v === "string") return v.slice(0, 16);
  if (type === "date" && typeof v === "string") return v.slice(0, 10);
  return String(v);
}

export function FieldGrid({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: Values;
  onChange: (name: string, value: unknown) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.name} className={cn("space-y-1.5", (f.full || f.type === "textarea" || f.type === "list") && "sm:col-span-2")}>
          <Label htmlFor={f.name} className="text-xs font-medium text-muted-foreground">
            {f.label}
            {f.required ? <span className="text-destructive"> *</span> : null}
          </Label>
          {f.type === "list" ? (
            <Textarea
              id={f.name}
              rows={4}
              value={Array.isArray(values[f.name]) ? (values[f.name] as string[]).join("\n") : toInputValue(values[f.name])}
              placeholder={f.placeholder}
              onChange={(e) =>
                onChange(
                  f.name,
                  e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          ) : f.type === "textarea" ? (
            <Textarea
              id={f.name}
              rows={3}
              value={toInputValue(values[f.name])}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.name, e.target.value)}
            />
          ) : f.type === "select" ? (

            <Select
              value={values[f.name] ? String(values[f.name]) : ""}
              onValueChange={(v) => onChange(f.name, v === "__none" ? null : v)}
            >
              <SelectTrigger id={f.name}>
                <SelectValue placeholder={f.placeholder ?? "Select…"} />
              </SelectTrigger>
              <SelectContent>
                {!f.required ? <SelectItem value="__none">— None —</SelectItem> : null}
                {(f.options ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : f.type === "switch" ? (
            <div className="flex h-9 items-center">
              <Switch
                id={f.name}
                checked={Boolean(values[f.name])}
                onCheckedChange={(v) => onChange(f.name, v)}
              />
            </div>
          ) : (
            <Input
              id={f.name}
              type={
                f.type === "money" || f.type === "number"
                  ? "number"
                  : f.type === "datetime"
                    ? "datetime-local"
                    : (f.type ?? "text")
              }
              step={f.type === "money" ? "0.01" : undefined}
              value={toInputValue(values[f.name], f.type)}
              placeholder={f.placeholder}
              onChange={(e) =>
                onChange(
                  f.name,
                  f.type === "money" || f.type === "number"
                    ? e.target.value === ""
                      ? null
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
          {f.help ? <p className="text-[11px] text-muted-foreground">{f.help}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function RecordDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  onSubmit,
  saving,
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: Field[];
  initial?: Values;
  onSubmit: (values: Values) => void | Promise<void>;
  saving?: boolean;
  extra?: ReactNode;
}) {
  const [values, setValues] = useState<Values>(initial ?? {});

  useEffect(() => {
    if (open) setValues(initial ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(values);
          }}
        >
          <FieldGrid
            fields={fields}
            values={values}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          />
          {extra}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
