-- Phase 3: recurring billing, reminders, inventory, time tracking, documents and payment-provider configuration.
create type public.recurring_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type public.reminder_status as enum ('pending', 'sent', 'failed', 'cancelled');
create type public.inventory_reason as enum ('opening_balance', 'purchase', 'sale', 'adjustment', 'return');

alter table public.products add column stock_on_hand numeric(19,4) not null default 0;

create table public.recurring_invoices (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict, frequency public.recurring_frequency not null default 'monthly',
  next_run_date date not null, due_days integer not null default 14 check (due_days between 0 and 365), notes text,
  active boolean not null default true, last_run_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.recurring_invoice_items (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  recurring_invoice_id uuid not null references public.recurring_invoices(id) on delete cascade, description text not null,
  quantity numeric(19,4) not null check (quantity > 0), unit_price numeric(19,4) not null check (unit_price >= 0),
  discount_amount numeric(19,4) not null default 0 check (discount_amount >= 0), tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100)
);
create table public.invoice_reminders (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade, scheduled_for timestamptz not null,
  status public.reminder_status not null default 'pending', attempt_count integer not null default 0 check (attempt_count >= 0), sent_at timestamptz,
  created_at timestamptz not null default now(), unique (invoice_id, scheduled_for)
);
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, quantity_delta numeric(19,4) not null check (quantity_delta <> 0),
  reason public.inventory_reason not null, note text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null, name text not null, hourly_rate numeric(19,4) check (hourly_rate >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.time_entries (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, user_id uuid not null references auth.users(id),
  entry_date date not null default current_date, minutes integer not null check (minutes between 1 and 1440), description text not null,
  billable boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payment_provider_configs (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('paystack', 'flutterwave', 'manual')), enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (business_id, provider)
);

create index recurring_invoices_next_run_idx on public.recurring_invoices(business_id, next_run_date) where active;
create index invoice_reminders_pending_idx on public.invoice_reminders(scheduled_for) where status = 'pending';
create index inventory_transactions_product_idx on public.inventory_transactions(product_id, created_at desc);
create index time_entries_business_date_idx on public.time_entries(business_id, entry_date desc);

insert into public.permissions(code, description) values
  ('recurring.read','Read recurring invoices'), ('recurring.manage','Manage recurring invoices'), ('reminders.read','Read reminders'), ('reminders.manage','Manage reminders'),
  ('inventory.read','Read inventory'), ('inventory.adjust','Adjust inventory'), ('time.read','Read time entries'), ('time.create','Create time entries'), ('time.update','Update time entries'),
  ('reports.read','Read reports'), ('payments.configure','Configure payment providers')
on conflict do nothing;
insert into public.role_permissions(role, permission_code)
select 'admin'::public.business_role, code from public.permissions where code in ('recurring.read','recurring.manage','reminders.read','reminders.manage','inventory.read','inventory.adjust','time.read','time.create','time.update','reports.read','payments.configure')
on conflict do nothing;
insert into public.role_permissions(role, permission_code) values
  ('accountant','recurring.read'), ('accountant','recurring.manage'), ('accountant','reminders.read'), ('accountant','reminders.manage'), ('accountant','inventory.read'), ('accountant','time.read'), ('accountant','reports.read'),
  ('staff','inventory.read'), ('staff','time.read'), ('staff','time.create'), ('staff','time.update')
on conflict do nothing;

alter table public.recurring_invoices enable row level security;
alter table public.recurring_invoice_items enable row level security;
alter table public.invoice_reminders enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.projects enable row level security;
alter table public.time_entries enable row level security;
alter table public.payment_provider_configs enable row level security;
create policy recurring_read on public.recurring_invoices for select to authenticated using (public.has_permission(business_id, 'recurring.read'));
create policy recurring_items_read on public.recurring_invoice_items for select to authenticated using (public.has_permission(business_id, 'recurring.read'));
create policy reminders_read on public.invoice_reminders for select to authenticated using (public.has_permission(business_id, 'reminders.read'));
create policy inventory_read on public.inventory_transactions for select to authenticated using (public.has_permission(business_id, 'inventory.read'));
create policy projects_read on public.projects for select to authenticated using (public.has_permission(business_id, 'time.read'));
create policy projects_write on public.projects for all to authenticated using (public.has_permission(business_id, 'time.update')) with check (public.has_permission(business_id, 'time.update'));
create policy time_entries_read on public.time_entries for select to authenticated using (public.has_permission(business_id, 'time.read'));
create policy time_entries_insert on public.time_entries for insert to authenticated with check (user_id = auth.uid() and public.has_permission(business_id, 'time.create'));
create policy time_entries_update on public.time_entries for update to authenticated using (user_id = auth.uid() and public.has_permission(business_id, 'time.update')) with check (user_id = auth.uid() and public.has_permission(business_id, 'time.update'));
create policy provider_configs_read on public.payment_provider_configs for select to authenticated using (public.has_permission(business_id, 'payments.configure'));
create policy provider_configs_write on public.payment_provider_configs for all to authenticated using (public.has_permission(business_id, 'payments.configure')) with check (public.has_permission(business_id, 'payments.configure'));
grant select, insert, update, delete on public.recurring_invoices, public.recurring_invoice_items, public.invoice_reminders, public.inventory_transactions, public.projects, public.time_entries, public.payment_provider_configs to authenticated;

create or replace function public.assert_recurring_item_tenant() returns trigger language plpgsql security definer set search_path = public as $$
begin if not exists (select 1 from public.recurring_invoices r where r.id = new.recurring_invoice_id and r.business_id = new.business_id) then raise exception 'recurring invoice tenant mismatch' using errcode = '42501'; end if; return new; end $$;
revoke all on function public.assert_recurring_item_tenant() from public;
create trigger recurring_item_tenant_guard before insert or update on public.recurring_invoice_items for each row execute function public.assert_recurring_item_tenant();
create or replace function public.assert_inventory_tenant() returns trigger language plpgsql security definer set search_path = public as $$
begin if not exists (select 1 from public.products p where p.id = new.product_id and p.business_id = new.business_id) then raise exception 'product tenant mismatch' using errcode = '42501'; end if; return new; end $$;
revoke all on function public.assert_inventory_tenant() from public;
create trigger inventory_tenant_guard before insert on public.inventory_transactions for each row execute function public.assert_inventory_tenant();
create or replace function public.assert_time_project_tenant() returns trigger language plpgsql security definer set search_path = public as $$
begin if not exists (select 1 from public.projects p where p.id = new.project_id and p.business_id = new.business_id) then raise exception 'project tenant mismatch' using errcode = '42501'; end if; return new; end $$;
revoke all on function public.assert_time_project_tenant() from public;
create trigger time_project_tenant_guard before insert or update on public.time_entries for each row execute function public.assert_time_project_tenant();

create or replace function public.adjust_inventory(p_business_id uuid, p_product_id uuid, p_quantity_delta numeric(19,4), p_reason public.inventory_reason, p_note text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare transaction_id uuid;
begin
  if not public.has_permission(p_business_id, 'inventory.adjust') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_quantity_delta = 0 then raise exception 'quantity delta must not be zero' using errcode = '22023'; end if;
  update public.products set stock_on_hand = stock_on_hand + p_quantity_delta where id = p_product_id and business_id = p_business_id;
  if not found then raise exception 'product tenant mismatch' using errcode = '42501'; end if;
  insert into public.inventory_transactions(business_id, product_id, quantity_delta, reason, note, created_by) values (p_business_id, p_product_id, p_quantity_delta, p_reason, nullif(trim(p_note), ''), auth.uid()) returning id into transaction_id;
  return transaction_id;
end $$;

create or replace function public.run_recurring_invoice(p_recurring_id uuid) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare recurring public.recurring_invoices%rowtype; invoice_id uuid; item_payload jsonb; next_date date;
begin
  select * into recurring from public.recurring_invoices where id = p_recurring_id for update;
  if recurring.id is null or not recurring.active or not public.has_permission(recurring.business_id, 'recurring.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unitPrice', unit_price, 'discountAmount', discount_amount, 'taxRate', tax_rate)) into item_payload from public.recurring_invoice_items where recurring_invoice_id = recurring.id;
  invoice_id := public.create_invoice(recurring.business_id, recurring.client_id, current_date + recurring.due_days, recurring.notes, item_payload);
  next_date := case recurring.frequency when 'weekly' then recurring.next_run_date + 7 when 'monthly' then recurring.next_run_date + interval '1 month' when 'quarterly' then recurring.next_run_date + interval '3 months' else recurring.next_run_date + interval '1 year' end;
  update public.recurring_invoices set next_run_date = next_date, last_run_at = now() where id = recurring.id;
  return invoice_id;
end $$;
revoke all on function public.adjust_inventory(uuid, uuid, numeric, public.inventory_reason, text), public.run_recurring_invoice(uuid) from public;
grant execute on function public.adjust_inventory(uuid, uuid, numeric, public.inventory_reason, text), public.run_recurring_invoice(uuid) to authenticated;
create trigger recurring_invoices_updated_at before update on public.recurring_invoices for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger time_entries_updated_at before update on public.time_entries for each row execute function public.set_updated_at();
create trigger payment_provider_configs_updated_at before update on public.payment_provider_configs for each row execute function public.set_updated_at();

create or replace function public.create_recurring_invoice(p_business_id uuid, p_client_id uuid, p_frequency public.recurring_frequency, p_next_run_date date, p_due_days integer, p_notes text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare recurring_id uuid; item jsonb; quantity_value numeric(19,4); unit_price_value numeric(19,4); discount_value numeric(19,4); tax_rate_value numeric(7,4); description_value text;
begin
  if not public.has_permission(p_business_id, 'recurring.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_next_run_date < current_date or p_due_days < 0 or p_due_days > 365 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then raise exception 'invalid recurring invoice' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and business_id = p_business_id) then raise exception 'client tenant mismatch' using errcode = '42501'; end if;
  insert into public.recurring_invoices(business_id, client_id, frequency, next_run_date, due_days, notes, created_by) values (p_business_id, p_client_id, p_frequency, p_next_run_date, p_due_days, nullif(trim(p_notes), ''), auth.uid()) returning id into recurring_id;
  for item in select value from jsonb_array_elements(p_items) loop
    begin description_value := left(trim(item->>'description'), 500); quantity_value := (item->>'quantity')::numeric(19,4); unit_price_value := (item->>'unitPrice')::numeric(19,4); discount_value := coalesce((item->>'discountAmount')::numeric(19,4), 0); tax_rate_value := coalesce((item->>'taxRate')::numeric(7,4), 0); exception when others then raise exception 'invalid recurring item values' using errcode = '22023'; end;
    if description_value is null or description_value = '' or quantity_value <= 0 or unit_price_value < 0 or discount_value < 0 or discount_value > quantity_value * unit_price_value or tax_rate_value < 0 or tax_rate_value > 100 then raise exception 'invalid recurring item' using errcode = '22023'; end if;
    insert into public.recurring_invoice_items(business_id, recurring_invoice_id, description, quantity, unit_price, discount_amount, tax_rate) values (p_business_id, recurring_id, description_value, quantity_value, unit_price_value, discount_value, tax_rate_value);
  end loop;
  return recurring_id;
end $$;

create or replace function public.send_invoice(p_invoice_id uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare target_business uuid; current_status public.invoice_status; due_date_value date;
begin
  select business_id, status, due_date into target_business, current_status, due_date_value from public.invoices where id = p_invoice_id for update;
  if target_business is null or not public.has_permission(target_business, 'invoices.send') then raise exception 'not authorized' using errcode = '42501'; end if;
  if current_status <> 'draft' then raise exception 'only draft invoices can be sent' using errcode = '22023'; end if;
  update public.invoices set status = 'sent' where id = p_invoice_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (target_business, p_invoice_id, 'sent', auth.uid());
  if due_date_value is not null then insert into public.invoice_reminders(business_id, invoice_id, scheduled_for) values (target_business, p_invoice_id, (due_date_value + 1)::timestamptz) on conflict do nothing; end if;
end $$;

revoke all on function public.create_recurring_invoice(uuid, uuid, public.recurring_frequency, date, integer, text, jsonb) from public;
grant execute on function public.create_recurring_invoice(uuid, uuid, public.recurring_frequency, date, integer, text, jsonb) to authenticated;
