-- =====================================================================
-- VYBE Business Management System — invoices.package_id repair
-- Additive & idempotent. Safe to re-run. Deletes no data, drops no table,
-- and changes no existing financial value.
-- Run in the Supabase SQL Editor AFTER supabase/update-03-presenters.sql.
--
-- WHY
-- createFinalInvoiceFromQuotation() has always written `package_id` into
-- public.invoices, but that column was never created: schema.sql builds
-- invoices without it and neither update-01 nor update-02 adds it. Every
-- sibling table already carries the link —
--     quotations.package_id, projects.package_id,
--     quotation_items.package_id, invoice_items.package_id
-- — so the column is a genuine omission rather than a rename, and the fix is
-- to add it. Verified against production: packages.id is uuid (22P02 on a
-- non-uuid filter) and invoices.package_id reports 42703 "does not exist".
--
-- The invoice keeps package_snapshot as well. The id is for relationships and
-- reporting; the snapshot is the historical record, so later catalogue price
-- changes can never alter an issued document.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------- 1. the column
-- uuid to match packages.id exactly, nullable so no existing invoice is
-- invalidated, and no default so nothing is rewritten.
alter table public.invoices add column if not exists package_id uuid;

-- --------------------------------------------------- 2. foreign key
-- ON DELETE SET NULL: removing a package must never cascade into deleting
-- historical invoices. ADD CONSTRAINT has no IF NOT EXISTS, hence the guard.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_package_id_fkey'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_package_id_fkey
      foreign key (package_id) references public.packages(id)
      on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------ 3. index
create index if not exists invoices_package_id_idx on public.invoices (package_id);

-- --------------------------------------------------------- 4. backfill
-- Populates ONLY the new column, and only where it is still null. No existing
-- invoice value is touched: totals, statuses and payments are untouched.
-- Source 1 — the quotation the invoice was created from.
update public.invoices i
   set package_id = q.package_id
  from public.quotations q
 where i.quotation_id = q.id
   and i.package_id is null
   and q.package_id is not null;

-- Source 2 — the snapshot already frozen on the invoice, for invoices whose
-- quotation link is missing. Only accepts a snapshot id that still resolves to
-- a real package, so the new foreign key cannot be violated.
update public.invoices i
   set package_id = (i.package_snapshot->>'id')::uuid
 where i.package_id is null
   and i.package_snapshot ? 'id'
   and (i.package_snapshot->>'id') ~ '^[0-9a-fA-F-]{36}$'
   and exists (select 1 from public.packages p where p.id = (i.package_snapshot->>'id')::uuid);

-- ------------------------------ 5. one active final invoice per quotation
-- Revisions stay legal: a revised or voided invoice drops out of the index, so
-- reviseInvoice() can still supersede an invoice. Created only when the data
-- is already clean — a pre-existing duplicate reports instead of failing the
-- whole migration.
do $$
declare dupes integer;
begin
  select count(*) into dupes from (
    select quotation_id from public.invoices
     where quotation_id is not null
       and doc_kind = 'final'
       and status not in ('void','revised')
       and deleted_at is null
     group by quotation_id having count(*) > 1
  ) d;

  if dupes > 0 then
    raise notice
      'Skipped invoices_one_active_final_per_quotation: % quotation(s) already have more than one active final invoice. Resolve those first, then re-run this migration.',
      dupes;
  else
    create unique index if not exists invoices_one_active_final_per_quotation
      on public.invoices (quotation_id)
      where quotation_id is not null
        and doc_kind = 'final'
        and status not in ('void','revised')
        and deleted_at is null;
  end if;
end $$;

-- --------------------------------------------------- 6. schema cache
-- PostgREST caches the schema; without this the API keeps reporting the old
-- "Could not find the 'package_id' column ... in the schema cache" until it
-- next reloads on its own.
notify pgrst, 'reload schema';
