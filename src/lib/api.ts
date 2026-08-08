import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "./supabase";

export type Row = Record<string, unknown>;

export async function selectAll<T = Row>(
  table: string,
  opts: {
    select?: string;
    order?: { column: string; ascending?: boolean };
    eq?: Record<string, unknown>;
    limit?: number;
  } = {},
): Promise<T[]> {
  let q = getSupabase()
    .from(table)
    .select(opts.select ?? "*");
  for (const [k, v] of Object.entries(opts.eq ?? {})) {
    if (v !== undefined && v !== null && v !== "") q = q.eq(k, v);
  }
  if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function selectOne<T = Row>(
  table: string,
  id: string,
  select = "*",
): Promise<T | null> {
  const { data, error } = await getSupabase().from(table).select(select).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}

export async function insertRow<T = Row>(table: string, values: Row): Promise<T> {
  const { data, error } = await getSupabase().from(table).insert(values).select().single();
  if (error) throw new Error(error.message);
  return data as T;
}

export async function updateRow<T = Row>(table: string, id: string, values: Row): Promise<T> {
  const { data, error } = await getSupabase()
    .from(table)
    .update(values)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as T;
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await getSupabase().from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function nextNumber(kind: "invoice" | "quotation" | "project"): Promise<string> {
  const { data, error } = await getSupabase().rpc("next_document_number", { _kind: kind });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function logActivity(entity_type: string, entity_id: string, action: string, detail?: Row) {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  await sb.from("activity_log").insert({
    entity_type,
    entity_id,
    action,
    detail: detail ?? null,
    actor_id: auth.user?.id ?? null,
  });
}

/** Generic list hook used across every module. */
export function useList<T = Row>(
  table: string,
  opts: Parameters<typeof selectAll>[1] = {},
  extraKey: unknown[] = [],
) {
  return useQuery({
    queryKey: [table, "list", opts, ...extraKey],
    queryFn: () => selectAll<T>(table, opts),
  });
}

export function useOne<T = Row>(table: string, id: string, select = "*") {
  return useQuery({
    queryKey: [table, "one", id, select],
    queryFn: () => selectOne<T>(table, id, select),
    enabled: Boolean(id),
  });
}

export function useSaveRow(table: string, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | undefined; values: Row }) =>
      id ? updateRow(table, id, values) : insertRow(table, values),
    onSuccess: () => {
      for (const key of [table, ...invalidate]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useDeleteRow(table: string, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow(table, id),
    onSuccess: () => {
      for (const key of [table, ...invalidate]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
