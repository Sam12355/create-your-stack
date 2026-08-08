-- =====================================================================
-- VYBE Business Management System — quotation ⇄ final invoice update
-- Additive & idempotent. Safe to re-run. Deletes no existing data.
-- Run in the Supabase SQL Editor AFTER supabase/update-01-process.sql.
-- =====================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------- enums
-- ALTER TYPE ... ADD VALUE must be a top-level statement.
alter type public.quotation_status add value if not exists 'awaiting_response';
alter type public.quotation_status add value if not exists 'revised';
alter type public.invoice_status   add value if not exists 'revised';

-- ---------------------------------------------------------- quotations
alter table public.quotations add column if not exists customer_snapshot jsonb;
alter table public.quotations add column if not exists package_description text;
alter table public.quotations add column if not exists inclusions text[] not null default '{}';
alter table public.quotations add column if not exists bank_details text;
alter table public.quotations add column if not exists terms_text text;
alter table public.quotations add column if not exists payment_instructions text;
alter table public.quotations add column if not exists version integer not null default 1;
alter table public.quotations add column if not exists revision_of uuid references public.quotations(id) on delete set null;
alter table public.quotations add column if not exists amendment_reason text;
alter table public.quotations add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists quotations_revision_idx on public.quotations (revision_of);

-- Version history: every edit of a saved quotation is recorded.
create table if not exists public.quotation_versions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  version integer not null default 1,
  previous jsonb,
  updated jsonb,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists quotation_versions_idx
  on public.quotation_versions (quotation_id, changed_at desc);

-- ------------------------------------------------------------ invoices
alter table public.invoices add column if not exists customer_snapshot jsonb;
alter table public.invoices add column if not exists package_snapshot jsonb;
alter table public.invoices add column if not exists package_description text;
alter table public.invoices add column if not exists inclusions text[] not null default '{}';
alter table public.invoices add column if not exists bank_details text;
alter table public.invoices add column if not exists terms_text text;
alter table public.invoices add column if not exists payment_instructions text;
alter table public.invoices add column if not exists quotation_total numeric(14,2) not null default 0;
alter table public.invoices add column if not exists adjustment_total numeric(14,2) not null default 0;
alter table public.invoices add column if not exists adjustment_note text;
alter table public.invoices add column if not exists advance_received numeric(14,2) not null default 0;

-- Additional-cost rows gain a type + audit fields used by the UI.
alter table public.invoice_additional_costs add column if not exists cost_type text not null default 'other';
alter table public.invoice_additional_costs add column if not exists notes text;

-- ------------------------------------------------------------ payments
-- Advance payments are recorded against a quotation before any invoice
-- exists, so invoice_id must be optional and a quotation link is added.
alter table public.payments alter column invoice_id drop not null;
alter table public.payments add column if not exists quotation_id uuid references public.quotations(id) on delete set null;
alter table public.payments add column if not exists kind text not null default 'payment';
create index if not exists payments_quotation_idx on public.payments (quotation_id);

-- ------------------------------------------------- grants + RLS (new)
grant select, insert, update, delete on public.quotation_versions to authenticated;
grant all on public.quotation_versions to service_role;
alter table public.quotation_versions enable row level security;
drop policy if exists "auth read quotation_versions" on public.quotation_versions;
create policy "auth read quotation_versions" on public.quotation_versions
  for select to authenticated using (true);
drop policy if exists "auth write quotation_versions" on public.quotation_versions;
create policy "auth write quotation_versions" on public.quotation_versions
  for insert to authenticated with check (true);
drop policy if exists "owner delete quotation_versions" on public.quotation_versions;
create policy "owner delete quotation_versions" on public.quotation_versions
  for delete to authenticated using (public.is_owner());

-- Backfill: keep quotation_total in step with existing linked invoices.
update public.invoices i
   set quotation_total = q.grand_total
  from public.quotations q
 where i.quotation_id = q.id and i.quotation_total = 0;
