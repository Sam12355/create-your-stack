-- =====================================================================
-- VYBE Business Management System — full schema
-- Run this once in your Supabase project (SQL Editor → New query → Run).
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS guards.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
do $$ begin create type public.app_role as enum ('owner','staff','accountant','editor','client'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_stage as enum ('new_inquiry','contacted','requirement_collected','quotation_sent','won','lost','on_hold'); exception when duplicate_object then null; end $$;
do $$ begin create type public.customer_type as enum ('monthly_retainer','one_time','studio_rental','website','video_production','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.billing_type as enum ('one_time','monthly','hourly','per_item','milestone'); exception when duplicate_object then null; end $$;
do $$ begin create type public.quotation_status as enum ('draft','sent','accepted','rejected','expired'); exception when duplicate_object then null; end $$;
do $$ begin create type public.project_status as enum ('planned','in_progress','waiting_client','review','delivered','closed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.task_status as enum ('todo','in_progress','waiting_client','done','blocked'); exception when duplicate_object then null; end $$;
do $$ begin create type public.invoice_status as enum ('draft','sent','partially_paid','paid','overdue','void'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_method as enum ('cash','bank_transfer','card','cheque','online','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.event_type as enum ('shoot','studio_booking','meeting','delivery','payment_due','reminder','other'); exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- utility
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- --------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles for update to authenticated using (auth.uid() = id);
drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- ------------------------------------------------------- user_roles
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'owner')
$$;

create or replace function public.can_manage_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(),'owner') or public.has_role(auth.uid(),'accountant')
$$;

create or replace function public.can_manage_ops() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(),'owner') or public.has_role(auth.uid(),'staff')
$$;

drop policy if exists "roles readable by authenticated" on public.user_roles;
create policy "roles readable by authenticated" on public.user_roles for select to authenticated using (true);
drop policy if exists "roles managed by owner" on public.user_roles;
create policy "roles managed by owner" on public.user_roles for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- First user to sign up becomes owner; everyone else gets a profile + staff role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare has_any boolean;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do nothing;
  select exists(select 1 from public.user_roles where role = 'owner') into has_any;
  insert into public.user_roles (user_id, role)
  values (new.id, case when has_any then 'staff'::public.app_role else 'owner'::public.app_role end)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- --------------------------------------------------------- settings
create table if not exists public.settings (
  id boolean primary key default true check (id),
  business_name text not null default 'VYBE Creative Media',
  logo_url text,
  address text,
  phone text,
  email text,
  website text,
  tax_number text,
  currency text not null default 'LKR',
  default_tax_rate numeric(6,3) not null default 0,
  bank_details text,
  invoice_prefix text not null default 'INV',
  quotation_prefix text not null default 'QT',
  project_prefix text not null default 'PRJ',
  invoice_terms text not null default '',
  website_terms text not null default '50% advance required. First-year domain and hosting included where stated; renewals charged annually. Additional features are quoted separately. No refund after commencement.',
  reminder_days_before_work integer not null default 2,
  reminder_days_before_due integer not null default 3,
  rounding_decimals integer not null default 2,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.settings to authenticated;
grant all on public.settings to service_role;
alter table public.settings enable row level security;
drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select to authenticated using (true);
drop policy if exists "settings write" on public.settings;
create policy "settings write" on public.settings for all to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.settings (id) values (true) on conflict (id) do nothing;

-- --------------------------------------------------------- customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  company text,
  contact_person text,
  phone text,
  whatsapp text,
  email text,
  address text,
  nic_br_number text,
  tax_number text,
  source text,
  preferred_contact text,
  customer_type public.customer_type not null default 'one_time',
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers (lower(name));

-- ------------------------------------------------------------- leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text,
  email text,
  source text,
  requirement text,
  budget numeric(14,2),
  stage public.lead_stage not null default 'new_inquiry',
  follow_up_date date,
  lost_reason text,
  customer_id uuid references public.customers(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_stage_idx on public.leads (stage);

-- --------------------------------------------------- workflow templates
create table if not exists public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  default_offset_days integer not null default 0,
  responsible_role public.app_role
);
create index if not exists workflow_stages_template_idx on public.workflow_stages (template_id, position);

-- ---------------------------------------------------------- packages
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  category text not null default 'Custom',
  name text not null,
  short_description text,
  scope text,
  billing_type public.billing_type not null default 'one_time',
  base_price numeric(14,2) not null default 0,
  currency text not null default 'LKR',
  tax_rate numeric(6,3) not null default 0,
  allow_discount boolean not null default true,
  deposit_percent numeric(6,3) not null default 0,
  deliverables text,
  revisions integer,
  duration_note text,
  exclusions text,
  workflow_template_id uuid references public.workflow_templates(id) on delete set null,
  expected_duration_days integer,
  responsible_role public.app_role,
  intro_discount_type text check (intro_discount_type in ('fixed','percent')),
  intro_discount_value numeric(14,2) not null default 0,
  intro_discount_eligible boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.package_addons (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  name text not null,
  unit_price numeric(14,2) not null default 0,
  unit text default 'item',
  is_active boolean not null default true
);

-- -------------------------------------------------------- quotations
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null default '',
  status public.quotation_status not null default 'draft',
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'LKR',
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  notes text,
  terms_snapshot text,
  rejected_reason text,
  follow_up_date date,
  accepted_at timestamptz,
  locked boolean not null default false,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  package_snapshot jsonb,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  line_total numeric(14,2) not null default 0,
  position integer not null default 0
);

-- ---------------------------------------------------------- projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  quotation_id uuid references public.quotations(id) on delete set null,
  package_id uuid references public.packages(id) on delete set null,
  package_snapshot jsonb,
  workflow_template_id uuid references public.workflow_templates(id) on delete set null,
  manager_id uuid references auth.users(id) on delete set null,
  project_type text,
  billing_type public.billing_type not null default 'one_time',
  status public.project_status not null default 'planned',
  start_date date,
  due_date date,
  delivered_at date,
  agreed_total numeric(14,2) not null default 0,
  currency text not null default 'LKR',
  description text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_label text,
  unique (project_id, user_id)
);
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  status public.task_status not null default 'todo',
  position integer not null default 0,
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  label text not null,
  url text not null,
  kind text default 'link',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  category text,
  description text not null,
  amount numeric(14,2) not null default 0,
  spent_on date not null default current_date,
  receipt_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------- calendar
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type public.event_type not null default 'shoot',
  project_id uuid references public.projects(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  resource text,
  status text not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_range_idx on public.calendar_events (starts_at, ends_at);

-- Prevent double-booking of the same resource (e.g. the studio).
create or replace function public.check_booking_conflict() returns trigger
language plpgsql as $$
begin
  if new.resource is not null and new.status <> 'cancelled' then
    if exists (
      select 1 from public.calendar_events e
      where e.resource = new.resource and e.id <> new.id and e.status <> 'cancelled'
        and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'Booking conflict: % is already booked for that time', new.resource;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists calendar_conflict_check on public.calendar_events;
create trigger calendar_conflict_check before insert or update on public.calendar_events
for each row execute function public.check_booking_conflict();

-- ----------------------------------------------------------- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  status public.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'LKR',
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  notes text,
  terms_snapshot text,
  business_snapshot jsonb,
  milestone_label text,
  issued_at timestamptz,
  locked boolean not null default false,
  void_reason text,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  package_snapshot jsonb,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  line_total numeric(14,2) not null default 0,
  position integer not null default 0
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  method public.payment_method not null default 'bank_transfer',
  reference text,
  proof_url text,
  paid_on date not null default current_date,
  receipt_number text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Keep invoice paid_total / balance / status in sync with payments.
create or replace function public.recalc_invoice_payments() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv_id uuid; total numeric(14,2); paid numeric(14,2); inv record;
begin
  inv_id := coalesce(new.invoice_id, old.invoice_id);
  select * into inv from public.invoices where id = inv_id;
  if inv is null then return coalesce(new, old); end if;
  select coalesce(sum(amount),0) into paid from public.payments where invoice_id = inv_id;
  total := inv.grand_total;
  update public.invoices set
    paid_total = paid,
    balance = total - paid,
    status = case
      when inv.status = 'void' then 'void'
      when paid >= total and total > 0 then 'paid'
      when paid > 0 then 'partially_paid'
      when inv.due_date is not null and inv.due_date < current_date and inv.status <> 'draft' then 'overdue'
      else inv.status end
  where id = inv_id;
  return coalesce(new, old);
end $$;
drop trigger if exists payments_recalc on public.payments;
create trigger payments_recalc after insert or update or delete on public.payments
for each row execute function public.recalc_invoice_payments();

-- ------------------------------------------------- notifications / log
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  body text,
  kind text not null default 'info',
  link text,
  due_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  detail jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id, created_at desc);

-- ------------------------------------------------ grants + RLS (bulk)
do $$
declare t text;
  ops text[] := array['customers','leads','workflow_templates','workflow_stages','packages','package_addons',
                      'quotations','quotation_items','projects','project_members','project_tasks','project_files',
                      'expenses','calendar_events','invoices','invoice_items','payments','activity_log'];
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

grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for all to authenticated
  using (user_id is null or user_id = auth.uid()) with check (user_id is null or user_id = auth.uid());

-- ------------------------------------------------------- updated_at
do $$
declare t text;
  tabs text[] := array['profiles','customers','leads','packages','quotations','projects','invoices'];
begin
  foreach t in array tabs loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I;', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$I for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- --------------------------------------------- document numbering RPC
create or replace function public.next_document_number(_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare pfx text; n integer; yr text := to_char(now(),'YYYY');
begin
  select case _kind
    when 'invoice' then invoice_prefix
    when 'quotation' then quotation_prefix
    else project_prefix end into pfx from public.settings where id;
  pfx := coalesce(pfx,'DOC');
  if _kind = 'invoice' then
    select count(*)+1 into n from public.invoices where to_char(created_at,'YYYY') = yr;
  elsif _kind = 'quotation' then
    select count(*)+1 into n from public.quotations where to_char(created_at,'YYYY') = yr;
  else
    select count(*)+1 into n from public.projects where to_char(created_at,'YYYY') = yr;
  end if;
  return pfx || '-' || yr || '-' || lpad(n::text, 4, '0');
end $$;
grant execute on function public.next_document_number(text) to authenticated;

-- --------------------------------------------------- starter catalogue
insert into public.workflow_templates (name, description)
select v.name, v.description from (values
  ('Social Media Monthly','Plan → content → shoot → edit → approval → schedule → report'),
  ('Video Production','Brief → script → shoot → edit → revision → delivery'),
  ('Studio Rental','Inquiry → availability → booking → advance → session → balance → close'),
  ('Website Project','Requirements → design → development → content → review → launch → handover')
) as v(name, description)
where not exists (select 1 from public.workflow_templates w where w.name = v.name);

insert into public.packages (code, category, name, billing_type, base_price, intro_discount_eligible, intro_discount_type, intro_discount_value)
select v.code, v.category, v.name, v.billing::public.billing_type, v.price, v.elig, v.dtype, v.dval from (values
  ('SM-BASIC','Social Media','Social Media Basic','monthly',25000,true,'fixed',1000),
  ('SM-STD','Social Media','Social Media Standard','monthly',45000,true,'fixed',2000),
  ('SM-PREM','Social Media','Social Media Premium','monthly',75000,true,'fixed',3000),
  ('VID-REEL','Video Production','On-location Reel','per_item',20000,true,'fixed',2000),
  ('STU-ONLY','Studio Rental','Studio Only (hourly)','hourly',3500,false,null,0),
  ('WEB-STD','Website','Website Design & Development','milestone',150000,false,null,0),
  ('EDIT-VID','Editing','Video Editing Only','per_item',4000,true,'fixed',1000)
) as v(code, category, name, billing, price, elig, dtype, dval)
where not exists (select 1 from public.packages p where p.code = v.code);
