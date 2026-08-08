-- =====================================================================
-- VYBE Business Management System — process update migration
-- Additive & idempotent. Safe to re-run. Does not delete existing data.
-- Run in the Supabase SQL Editor AFTER supabase/schema.sql.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------- enums
do $$ begin
  alter type public.quotation_status add value if not exists 'awaiting_response';
exception when others then null; end $$;

do $$ begin create type public.stage_status as enum
  ('not_started','in_progress','waiting_client','scheduled','completed','skipped','on_hold');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------- settings
alter table public.settings add column if not exists customer_prefix text not null default 'VYBE-CUS';
alter table public.settings add column if not exists advance_percent numeric(6,3) not null default 50;
alter table public.settings add column if not exists brand_primary text not null default '#6D28D9';
alter table public.settings add column if not exists brand_accent text not null default '#111111';
alter table public.settings add column if not exists footer_text text not null default '';
alter table public.settings add column if not exists payment_instructions text not null default '';
alter table public.settings add column if not exists signature_label text not null default 'Authorised Signature — VYBE Creative Media';
alter table public.settings add column if not exists quotation_terms text not null default '';
alter table public.settings add column if not exists advance_term text not null default
  'A 50% advance payment from the total quotation value is required to confirm the project and commence the work. The remaining balance, together with any approved additional costs, must be paid according to the final invoice/payment schedule.';

-- Move legacy short prefixes to the VYBE document format (only if untouched).
update public.settings set quotation_prefix = 'VYBE-QUO' where quotation_prefix in ('QT','QUO');
update public.settings set invoice_prefix   = 'VYBE-INV' where invoice_prefix in ('INV');
update public.settings set project_prefix   = 'VYBE-PRJ' where project_prefix in ('PRJ');
update public.settings set advance_term =
  'A 50% advance payment from the total quotation value is required to confirm the project and commence the work. The remaining balance, together with any approved additional costs, must be paid according to the final invoice/payment schedule.'
  where coalesce(advance_term,'') = '';

-- --------------------------------------------------------- customers
alter table public.customers add column if not exists customer_no text unique;
alter table public.customers add column if not exists package_id uuid references public.packages(id) on delete set null;
alter table public.customers add column if not exists package_snapshot jsonb;
alter table public.customers add column if not exists custom_package jsonb;

create or replace function public.next_customer_number() returns text
language plpgsql security definer set search_path = public as $$
declare pfx text; yr text := to_char(now(),'YYYY'); n integer;
begin
  select coalesce(customer_prefix,'VYBE-CUS') into pfx from public.settings where id;
  pfx := coalesce(pfx,'VYBE-CUS');
  select coalesce(max(nullif(regexp_replace(customer_no, '^.*-', ''), '')::integer), 0) + 1
    into n from public.customers where customer_no like pfx || '-' || yr || '-%';
  return pfx || '-' || yr || '-' || lpad(coalesce(n,1)::text, 4, '0');
end $$;
grant execute on function public.next_customer_number() to authenticated;

create or replace function public.set_customer_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_no is null or new.customer_no = '' then
    new.customer_no := public.next_customer_number();
  end if;
  return new;
end $$;
drop trigger if exists customers_number on public.customers;
create trigger customers_number before insert on public.customers
for each row execute function public.set_customer_number();

-- Backfill existing customers with stable numbers (oldest first).
do $$
declare r record; yr text := to_char(now(),'YYYY'); i integer := 0; pfx text;
begin
  select coalesce(customer_prefix,'VYBE-CUS') into pfx from public.settings where id;
  for r in select id from public.customers where customer_no is null order by created_at loop
    i := i + 1;
    update public.customers
      set customer_no = pfx || '-' || yr || '-' || lpad(i::text,4,'0')
      where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------- packages
alter table public.packages add column if not exists inclusions text[] not null default '{}';
alter table public.packages add column if not exists notes text;

-- Backfill inclusions from the legacy free-text deliverables field.
update public.packages
  set inclusions = string_to_array(regexp_replace(deliverables, E'\r', '', 'g'), E'\n')
  where inclusions = '{}' and coalesce(deliverables,'') <> '';

-- -------------------------------------------------- workflow templates
alter table public.workflow_templates add column if not exists work_type text;
alter table public.workflow_templates add column if not exists is_default boolean not null default false;

alter table public.workflow_stages add column if not exists description text;
alter table public.workflow_stages add column if not exists is_optional boolean not null default false;
alter table public.workflow_stages add column if not exists is_active boolean not null default true;
alter table public.workflow_stages add column if not exists requires_approval boolean not null default false;
alter table public.workflow_stages add column if not exists requires_payment boolean not null default false;
alter table public.workflow_stages add column if not exists requires_file boolean not null default false;
alter table public.workflow_stages add column if not exists creates_calendar_event boolean not null default false;
alter table public.workflow_stages add column if not exists reminder_days_before integer;
alter table public.workflow_stages add column if not exists checklist text[] not null default '{}';
alter table public.workflow_stages add column if not exists depends_on_position integer;

-- --------------------------------------------------- project workflow
alter table public.projects add column if not exists work_type text;
alter table public.projects add column if not exists current_stage_id uuid;

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  template_stage_id uuid references public.workflow_stages(id) on delete set null,
  name text not null,
  description text,
  position integer not null default 0,
  status public.stage_status not null default 'not_started',
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  scheduled_at timestamptz,
  completed_at timestamptz,
  next_action text,
  notes text,
  waiting_reason text,
  last_contact_date date,
  follow_up_date date,
  evidence_url text,
  checklist jsonb not null default '[]'::jsonb,
  requires_approval boolean not null default false,
  requires_payment boolean not null default false,
  requires_file boolean not null default false,
  is_optional boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_stages_project_idx on public.project_stages (project_id, position);

create table if not exists public.project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid references public.project_stages(id) on delete set null,
  from_stage text,
  to_stage text,
  from_status text,
  to_status text,
  notes text,
  evidence_url text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists project_stage_history_idx on public.project_stage_history (project_id, changed_at desc);

-- --------------------------------------------------------- quotations
alter table public.quotations add column if not exists package_id uuid references public.packages(id) on delete set null;
alter table public.quotations add column if not exists package_snapshot jsonb;
alter table public.quotations add column if not exists template_snapshot jsonb;
alter table public.quotations add column if not exists advance_percent numeric(6,3) not null default 50;
alter table public.quotations add column if not exists advance_amount numeric(14,2) not null default 0;
alter table public.quotations add column if not exists balance_amount numeric(14,2) not null default 0;
alter table public.quotations add column if not exists sent_at timestamptz;
alter table public.quotations add column if not exists sent_method text;
alter table public.quotations add column if not exists discount_approved_by uuid references auth.users(id) on delete set null;
alter table public.quotations add column if not exists discount_approved_at timestamptz;
alter table public.quotations add column if not exists project_id uuid references public.projects(id) on delete set null;

-- ----------------------------------------------------- discount audit
create table if not exists public.discount_applications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  discount_type text not null default 'fixed',
  discount_value numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists discount_once_per_customer_package
  on public.discount_applications (customer_id, package_id)
  where customer_id is not null and package_id is not null;

-- ----------------------------------------------------------- invoices
alter table public.invoices add column if not exists doc_kind text not null default 'final';
alter table public.invoices add column if not exists quotation_snapshot jsonb;
alter table public.invoices add column if not exists template_snapshot jsonb;
alter table public.invoices add column if not exists advance_expected numeric(14,2) not null default 0;
alter table public.invoices add column if not exists additional_total numeric(14,2) not null default 0;
alter table public.invoices add column if not exists revision_of uuid references public.invoices(id) on delete set null;
alter table public.invoices add column if not exists version integer not null default 1;
alter table public.invoices add column if not exists amendment_reason text;

create table if not exists public.invoice_additional_costs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  reason text,
  approval_status text not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_additional_costs_idx on public.invoice_additional_costs (invoice_id);

-- ----------------------------------------------------------- calendar
alter table public.calendar_events add column if not exists stage_id uuid references public.project_stages(id) on delete set null;
alter table public.calendar_events add column if not exists reminder_minutes integer;
create unique index if not exists calendar_events_stage_unique
  on public.calendar_events (stage_id) where stage_id is not null;

-- -------------------------- document numbering (VYBE-XXX-YYYY-0001)
create or replace function public.next_document_number(_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare pfx text; n integer; yr text := to_char(now(),'YYYY');
begin
  select case _kind
    when 'invoice' then invoice_prefix
    when 'quotation' then quotation_prefix
    else project_prefix end into pfx from public.settings where id;
  pfx := coalesce(pfx, case _kind when 'invoice' then 'VYBE-INV' when 'quotation' then 'VYBE-QUO' else 'VYBE-PRJ' end);
  if _kind = 'invoice' then
    select coalesce(max(nullif(regexp_replace(number,'^.*-','') ,'')::integer),0)+1 into n
      from public.invoices where number like pfx || '-' || yr || '-%';
  elsif _kind = 'quotation' then
    select coalesce(max(nullif(regexp_replace(number,'^.*-','') ,'')::integer),0)+1 into n
      from public.quotations where number like pfx || '-' || yr || '-%';
  else
    select coalesce(max(nullif(regexp_replace(code,'^.*-','') ,'')::integer),0)+1 into n
      from public.projects where code like pfx || '-' || yr || '-%';
  end if;
  return pfx || '-' || yr || '-' || lpad(coalesce(n,1)::text, 4, '0');
end $$;
grant execute on function public.next_document_number(text) to authenticated;

-- ------------------------------------------------ grants + RLS (new)
do $$
declare t text;
  ops text[] := array['project_stages','project_stage_history','invoice_additional_costs','discount_applications'];
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

drop trigger if exists set_updated_at_project_stages on public.project_stages;
create trigger set_updated_at_project_stages before update on public.project_stages
for each row execute function public.set_updated_at();

-- ------------------------------------------- default workflow templates
do $$
declare tpl_id uuid; i integer; stages text[];
begin
  -- Video Production
  select id into tpl_id from public.workflow_templates where name = 'Video Production' limit 1;
  if tpl_id is null then
    insert into public.workflow_templates (name, description, work_type, is_default)
    values ('Video Production','Quotation → advance → script → production → editing → delivery → final invoice','video_production',true)
    returning id into tpl_id;
  else
    update public.workflow_templates set work_type = coalesce(work_type,'video_production') where id = tpl_id;
  end if;
  if not exists (select 1 from public.workflow_stages where template_id = tpl_id) then
    stages := array['Quotation Drafted','Quotation Sent','Awaiting Customer Response','50% Advance Pending',
      'Advance Paid / Project Confirmed','Script in Progress','Script Sent for Approval','Script Approved',
      'Production Date Selection','Production Scheduled','Recording Completed','Editing in Progress',
      'Preview Sent / Client Review','Revision in Progress','Final Approved / Delivered',
      'Final Invoice / Balance Pending','Completed'];
    for i in 1..array_length(stages,1) loop
      insert into public.workflow_stages (template_id, name, position,
        requires_payment, requires_approval, requires_file, creates_calendar_event)
      values (tpl_id, stages[i], i,
        stages[i] in ('50% Advance Pending','Advance Paid / Project Confirmed','Final Invoice / Balance Pending'),
        stages[i] in ('Script Sent for Approval','Script Approved','Preview Sent / Client Review','Final Approved / Delivered'),
        stages[i] in ('Recording Completed','Final Approved / Delivered'),
        stages[i] in ('Production Scheduled'));
    end loop;
  end if;

  -- Studio Rental
  select id into tpl_id from public.workflow_templates where name = 'Studio Rental' limit 1;
  if tpl_id is null then
    insert into public.workflow_templates (name, description, work_type, is_default)
    values ('Studio Rental','Inquiry → booking → session → balance → completed','studio_rental',true)
    returning id into tpl_id;
  else
    update public.workflow_templates set work_type = coalesce(work_type,'studio_rental') where id = tpl_id;
  end if;
  if not exists (select 1 from public.workflow_stages where template_id = tpl_id) then
    stages := array['Inquiry','Package Selected','Quotation Sent','Awaiting Customer Response','Advance Pending',
      'Booking Date Selection','Booking Confirmed','Reminder Sent','Studio Session Completed',
      'Extra Time/Cost Check','Balance Paid','Completed'];
    for i in 1..array_length(stages,1) loop
      insert into public.workflow_stages (template_id, name, position, requires_payment, creates_calendar_event)
      values (tpl_id, stages[i], i,
        stages[i] in ('Advance Pending','Balance Paid'),
        stages[i] in ('Booking Confirmed'));
    end loop;
  end if;

  -- Editing Only
  select id into tpl_id from public.workflow_templates where name = 'Editing Only' limit 1;
  if tpl_id is null then
    insert into public.workflow_templates (name, description, work_type, is_default)
    values ('Editing Only','Brief → advance → editing → preview → revision → delivery','editing',true)
    returning id into tpl_id;
  end if;
  if not exists (select 1 from public.workflow_stages where template_id = tpl_id) then
    stages := array['Files/Brief Received','Quotation Sent','Awaiting Customer Response','Advance Paid',
      'Files Organized','Editing in Progress','Preview Sent','Waiting for Feedback','Revision',
      'Final Approved','Final Invoice/Balance','Delivered'];
    for i in 1..array_length(stages,1) loop
      insert into public.workflow_stages (template_id, name, position, requires_payment, requires_approval)
      values (tpl_id, stages[i], i,
        stages[i] in ('Advance Paid','Final Invoice/Balance'),
        stages[i] in ('Final Approved'));
    end loop;
  end if;

  -- Social Media Management
  select id into tpl_id from public.workflow_templates where name = 'Social Media Management' limit 1;
  if tpl_id is null then
    insert into public.workflow_templates (name, description, work_type, is_default)
    values ('Social Media Management','Onboarding → plan → approval → publish → report → renewal','social_media',true)
    returning id into tpl_id;
  end if;
  if not exists (select 1 from public.workflow_stages where template_id = tpl_id) then
    stages := array['Quotation Sent','Accepted/Advance Paid','Client Onboarding','Monthly Information Pending',
      'Content Plan','Client Approval','Design/Caption Creation','Client Review',
      'Content Scheduling/Publishing','Monthly Report','Renewal'];
    for i in 1..array_length(stages,1) loop
      insert into public.workflow_stages (template_id, name, position, requires_payment, requires_approval)
      values (tpl_id, stages[i], i,
        stages[i] in ('Accepted/Advance Paid'),
        stages[i] in ('Client Approval','Client Review'));
    end loop;
  end if;

  -- Website Development
  select id into tpl_id from public.workflow_templates where name = 'Website Development' limit 1;
  if tpl_id is null then
    insert into public.workflow_templates (name, description, work_type, is_default)
    values ('Website Development','Requirements → design → development → testing → launch → support','website',true)
    returning id into tpl_id;
  end if;
  if not exists (select 1 from public.workflow_stages where template_id = tpl_id) then
    stages := array['Quotation Sent','Accepted/Advance Paid','Requirements Pending','Sitemap/Wireframe','Design',
      'Design Approval','Development','Content Pending','Testing','Client Review','Revisions',
      'Website Launch','Final Invoice/Balance','Support/Renewal'];
    for i in 1..array_length(stages,1) loop
      insert into public.workflow_stages (template_id, name, position, requires_payment, requires_approval)
      values (tpl_id, stages[i], i,
        stages[i] in ('Accepted/Advance Paid','Final Invoice/Balance'),
        stages[i] in ('Design Approval','Client Review'));
    end loop;
  end if;
end $$;
