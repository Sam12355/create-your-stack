-- =====================================================================
-- VYBE Business Management System — Presenter Management & Pricing
-- Additive & idempotent. Safe to re-run. Deletes no existing data and
-- changes no existing customer, package, quotation, invoice, project,
-- payment or workflow row.
-- Run in the Supabase SQL Editor AFTER supabase/update-02-quote-invoice.sql.
--
-- What this adds:
--   presenters                  master records + default duration pricing
--   presenter_rate_tiers        Pricing Method B (up-to-duration price tiers)
--   quotation_presenters        per-quotation snapshot of agreed presenter terms
--   invoice_presenters          per-invoice copy + adjustment vs the quoted price
--   presenter_payouts           amount charged to client vs amount payable to presenter
--   quotations.presenter_total  presenter charges, held OUTSIDE the discountable subtotal
--   invoices.presenter_total    same, on the invoice side
-- =====================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------- settings
alter table public.settings add column if not exists presenter_prefix text not null default 'VYBE-PRE';

-- ------------------------------------------------------------- presenters
create table if not exists public.presenters (
  id uuid primary key default gen_random_uuid(),
  presenter_no text unique,
  name text not null,
  display_name text,
  phone text,
  whatsapp text,
  email text,
  address text,
  -- Multiple types/languages are allowed; 'Custom' is free text stored alongside.
  presenter_types text[] not null default '{}',
  custom_type text,
  languages text[] not null default '{}',
  short_description text,
  photo_url text,

  -- Pricing method A — base duration + additional time.
  pricing_method text not null default 'base_additional'
    check (pricing_method in ('base_additional','tiers','both')),
  base_duration numeric(10,2) not null default 1,
  duration_unit text not null default 'minute',
  base_price numeric(14,2) not null default 0,
  additional_unit numeric(10,2) not null default 1,
  additional_price numeric(14,2) not null default 0,

  -- Default travel charge; per-quotation value may differ or be zero.
  travel_charge numeric(14,2) not null default 0,

  pricing_notes text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presenters_name_idx on public.presenters (lower(name));
create index if not exists presenters_active_idx on public.presenters (is_active);

-- Pricing method B — editable "up to N minutes = Rs. X" tiers.
create table if not exists public.presenter_rate_tiers (
  id uuid primary key default gen_random_uuid(),
  presenter_id uuid not null references public.presenters(id) on delete cascade,
  label text,
  up_to_duration numeric(10,2),
  price numeric(14,2) not null default 0,
  is_custom boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists presenter_rate_tiers_idx
  on public.presenter_rate_tiers (presenter_id, position);

-- ------------------------------------------------- presenter numbering
-- Mirrors public.next_customer_number(): VYBE-PRE-0001, gap-free per prefix.
create or replace function public.next_presenter_number() returns text
language plpgsql security definer set search_path = public as $$
declare pfx text; n integer;
begin
  select coalesce(presenter_prefix,'VYBE-PRE') into pfx from public.settings where id;
  pfx := coalesce(pfx,'VYBE-PRE');
  select coalesce(max(nullif(regexp_replace(presenter_no, '^.*-', ''), '')::integer), 0) + 1
    into n from public.presenters where presenter_no like pfx || '-%';
  return pfx || '-' || lpad(coalesce(n,1)::text, 4, '0');
end $$;
grant execute on function public.next_presenter_number() to authenticated;

create or replace function public.set_presenter_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.presenter_no is null or new.presenter_no = '' then
    new.presenter_no := public.next_presenter_number();
  end if;
  return new;
end $$;
drop trigger if exists presenters_number on public.presenters;
create trigger presenters_number before insert on public.presenters
for each row execute function public.set_presenter_number();

-- -------------------------------------------- quotation presenter rows
-- presenter_id is ON DELETE SET NULL and every displayed value is denormalised
-- here, so a historical document keeps reading correctly even if the master
-- record is ever removed. In practice the delete guard below prevents that.
create table if not exists public.quotation_presenters (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  presenter_id uuid references public.presenters(id) on delete set null,
  presenter_snapshot jsonb,
  presenter_no text,
  presenter_name text not null default '',

  duration numeric(10,2) not null default 0,
  duration_unit text not null default 'minute',
  tier_label text,
  videos integer not null default 1,

  base_rate numeric(14,2) not null default 0,
  additional_duration numeric(10,2) not null default 0,
  additional_rate numeric(14,2) not null default 0,
  additional_amount numeric(14,2) not null default 0,

  travel_required boolean not null default false,
  travel_location text,
  travel_charge numeric(14,2) not null default 0,
  travel_visits integer not null default 1,
  travel_notes text,

  other_charges numeric(14,2) not null default 0,
  other_charges_note text,

  pricing_notes text,
  performance_total numeric(14,2) not null default 0,
  travel_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotation_presenters_idx
  on public.quotation_presenters (quotation_id, position);
create index if not exists quotation_presenters_presenter_idx
  on public.quotation_presenters (presenter_id);

-- ---------------------------------------------- invoice presenter rows
create table if not exists public.invoice_presenters (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  presenter_id uuid references public.presenters(id) on delete set null,
  source_quotation_presenter_id uuid references public.quotation_presenters(id) on delete set null,
  presenter_snapshot jsonb,
  presenter_no text,
  presenter_name text not null default '',

  duration numeric(10,2) not null default 0,
  duration_unit text not null default 'minute',
  tier_label text,
  videos integer not null default 1,

  base_rate numeric(14,2) not null default 0,
  additional_duration numeric(10,2) not null default 0,
  additional_rate numeric(14,2) not null default 0,
  additional_amount numeric(14,2) not null default 0,

  travel_required boolean not null default false,
  travel_location text,
  travel_charge numeric(14,2) not null default 0,
  travel_visits integer not null default 1,
  travel_notes text,

  other_charges numeric(14,2) not null default 0,
  other_charges_note text,

  pricing_notes text,
  performance_total numeric(14,2) not null default 0,
  travel_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,

  -- The figure agreed on the accepted quotation. Kept for side-by-side
  -- comparison so changing the invoice never rewrites quotation history.
  quoted_total numeric(14,2) not null default 0,
  adjustment_reason text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_presenters_idx
  on public.invoice_presenters (invoice_id, position);
create index if not exists invoice_presenters_presenter_idx
  on public.invoice_presenters (presenter_id);

-- ------------------------------------------------------ presenter payouts
-- "Charged to the client" and "payable to the presenter" are deliberately two
-- separate columns — they are frequently different numbers.
create table if not exists public.presenter_payouts (
  id uuid primary key default gen_random_uuid(),
  presenter_id uuid not null references public.presenters(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,

  amount_charged numeric(14,2) not null default 0,
  amount_payable numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  status text not null default 'not_paid' check (status in ('not_paid','partially_paid','paid')),
  paid_on date,
  method public.payment_method,
  reference text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presenter_payouts_presenter_idx
  on public.presenter_payouts (presenter_id, created_at desc);

-- Keep status honest with the amounts actually recorded.
create or replace function public.sync_presenter_payout_status() returns trigger
language plpgsql as $$
begin
  if new.amount_paid <= 0 then
    new.status := 'not_paid';
  elsif new.amount_paid >= new.amount_payable and new.amount_payable > 0 then
    new.status := 'paid';
  else
    new.status := 'partially_paid';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists presenter_payouts_status on public.presenter_payouts;
create trigger presenter_payouts_status before insert or update on public.presenter_payouts
for each row execute function public.sync_presenter_payout_status();

-- ------------------------------------- document presenter total columns
-- Held separately from `subtotal` so the introductory discount, which is
-- computed on package line items only, can never reach presenter money.
alter table public.quotations add column if not exists presenter_total numeric(14,2) not null default 0;
alter table public.invoices   add column if not exists presenter_total numeric(14,2) not null default 0;

-- ------------------------------------------------ delete guard (§14)
-- A presenter referenced by any historical quotation or invoice must not be
-- deleted; deactivate instead. Inactive presenters stay visible on the
-- documents that already reference them.
create or replace function public.guard_presenter_delete() returns trigger
language plpgsql as $$
declare q integer; i integer; p integer;
begin
  select count(*) into q from public.quotation_presenters where presenter_id = old.id;
  select count(*) into i from public.invoice_presenters   where presenter_id = old.id;
  select count(*) into p from public.presenter_payouts    where presenter_id = old.id;
  if q > 0 or i > 0 or p > 0 then
    raise exception
      'Presenter % is used on % quotation(s), % invoice(s) and % payout record(s) and cannot be deleted. Deactivate the presenter instead.',
      coalesce(old.presenter_no, old.name), q, i, p
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;
drop trigger if exists presenters_delete_guard on public.presenters;
create trigger presenters_delete_guard before delete on public.presenters
for each row execute function public.guard_presenter_delete();

-- ------------------------------------------------- grants + RLS (new)
-- Same shape as every other table on this system: any authenticated user can
-- read/insert/update; only an owner can delete.
do $$
declare t text;
  ops text[] := array['presenters','presenter_rate_tiers','quotation_presenters',
                      'invoice_presenters','presenter_payouts'];
begin
  foreach t in array ops loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "auth read %1$s" on public.%1$I;', t);
    execute format('create policy "auth read %1$s" on public.%1$I for select to authenticated using (true);', t);
    execute format('drop policy if exists "auth write %1$s" on public.%1$I;', t);
    execute format('create policy "auth write %1$s" on public.%1$I for insert to authenticated with check (true);', t);
    execute format('drop policy if exists "auth update %1$s" on public.%1$I;', t);
    execute format('create policy "auth update %1$s" on public.%1$I for update to authenticated using (true) with check (true);', t);
    execute format('drop policy if exists "owner delete %1$s" on public.%1$I;', t);
    execute format('create policy "owner delete %1$s" on public.%1$I for delete to authenticated using (public.is_owner());', t);
  end loop;
end $$;

-- Default pricing is owner-only (§14). Reading stays open so staff can still
-- pick a presenter for a quotation; only the master record is protected.
drop policy if exists "auth write presenters" on public.presenters;
create policy "auth write presenters" on public.presenters
  for insert to authenticated with check (public.is_owner());
drop policy if exists "auth update presenters" on public.presenters;
create policy "auth update presenters" on public.presenters
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "auth write presenter_rate_tiers" on public.presenter_rate_tiers;
create policy "auth write presenter_rate_tiers" on public.presenter_rate_tiers
  for insert to authenticated with check (public.is_owner());
drop policy if exists "auth update presenter_rate_tiers" on public.presenter_rate_tiers;
create policy "auth update presenter_rate_tiers" on public.presenter_rate_tiers
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner delete presenter_rate_tiers" on public.presenter_rate_tiers;
create policy "owner delete presenter_rate_tiers" on public.presenter_rate_tiers
  for delete to authenticated using (public.is_owner());

-- ---------------------------------------------------------- updated_at
do $$
declare t text;
  tabs text[] := array['presenters','quotation_presenters','invoice_presenters'];
begin
  foreach t in array tabs loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I;', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$I for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ------------------------------------------------------- backfill guard
-- Existing documents have no presenters, so their presenter_total is 0 and
-- their stored grand_total is already correct. Nothing is recalculated here
-- on purpose: issued documents must never move because of this migration.
