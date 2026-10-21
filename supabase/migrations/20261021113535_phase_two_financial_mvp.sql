-- Phase 2: secure invoicing, quotes, payments and business profile.
alter table public.businesses
  add column legal_name text,
  add column email text,
  add column phone text,
  add column address text,
  add column tax_number text,
  add column invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9-]{1,12}$');

create table public.invoice_sequences (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  next_number bigint not null default 1 check (next_number > 0)
);
create table public.invoice_status_history (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  status public.invoice_status not null, changed_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted');
create table public.quotes (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict, quote_number text not null,
  status public.quote_status not null default 'draft', issue_date date not null default current_date, expiry_date date,
  currency_code char(3) not null, subtotal numeric(19,4) not null default 0 check (subtotal >= 0),
  discount_total numeric(19,4) not null default 0 check (discount_total >= 0), tax_total numeric(19,4) not null default 0 check (tax_total >= 0),
  total numeric(19,4) not null default 0 check (total >= 0), notes text, converted_invoice_id uuid unique references public.invoices(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (business_id, quote_number)
);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade, description text not null,
  quantity numeric(19,4) not null check (quantity > 0), unit_price numeric(19,4) not null check (unit_price >= 0),
  discount_amount numeric(19,4) not null default 0 check (discount_amount >= 0), tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  line_total numeric(19,4) not null check (line_total >= 0)
);
create index quotes_business_status_idx on public.quotes(business_id, status, created_at desc);
create index quote_items_quote_idx on public.quote_items(quote_id);
create index invoice_status_history_invoice_idx on public.invoice_status_history(invoice_id, created_at desc);

insert into public.permissions(code, description) values
  ('invoices.send', 'Send invoices'), ('quotes.read', 'Read quotes'), ('quotes.create', 'Create quotes'), ('quotes.update', 'Update quotes'), ('quotes.convert', 'Convert quotes to invoices')
on conflict do nothing;
insert into public.role_permissions(role, permission_code)
select 'admin'::public.business_role, code from public.permissions where code like 'quotes.%' or code = 'invoices.send'
on conflict do nothing;
insert into public.role_permissions(role, permission_code) values
  ('accountant','invoices.send'), ('accountant','quotes.read'), ('accountant','quotes.create'), ('accountant','quotes.update'), ('accountant','quotes.convert'),
  ('staff','quotes.read')
on conflict do nothing;

alter table public.invoice_sequences enable row level security;
alter table public.invoice_status_history enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
create policy invoice_sequence_read on public.invoice_sequences for select to authenticated using (public.has_permission(business_id, 'invoices.read'));
create policy invoice_history_read on public.invoice_status_history for select to authenticated using (public.has_permission(business_id, 'invoices.read'));
create policy quotes_read on public.quotes for select to authenticated using (public.has_permission(business_id, 'quotes.read'));
create policy quote_items_read on public.quote_items for select to authenticated using (public.has_permission(business_id, 'quotes.read'));
grant select on public.invoice_sequences, public.invoice_status_history, public.quotes, public.quote_items to authenticated;

-- Financial documents must be produced by transactional RPCs, not direct table writes.
drop policy invoices_insert on public.invoices;
drop policy invoices_update on public.invoices;
drop policy invoices_delete on public.invoices;
drop policy invoice_items_insert on public.invoice_items;
drop policy invoice_items_update on public.invoice_items;
drop policy invoice_items_delete on public.invoice_items;
drop policy payments_insert on public.payments;

create or replace function public.next_document_number(target_business uuid, document_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare sequence_value bigint;
begin
  insert into public.invoice_sequences(business_id) values (target_business) on conflict do nothing;
  select next_number into sequence_value from public.invoice_sequences where business_id = target_business for update;
  update public.invoice_sequences set next_number = sequence_value + 1 where business_id = target_business;
  return document_prefix || '-' || lpad(sequence_value::text, 6, '0');
end $$;
revoke all on function public.next_document_number(uuid, text) from public;

create or replace function public.create_invoice(
  p_business_id uuid, p_client_id uuid, p_due_date date, p_notes text, p_items jsonb
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare invoice_id uuid; item jsonb; line_subtotal numeric(19,4); line_discount numeric(19,4); line_tax numeric(19,4); line_total numeric(19,4);
declare total_subtotal numeric(19,4) := 0; total_discount numeric(19,4) := 0; total_tax numeric(19,4) := 0; total_amount numeric(19,4) := 0;
declare quantity_value numeric(19,4); unit_price_value numeric(19,4); discount_value numeric(19,4); tax_rate_value numeric(7,4); description_value text;
declare currency_value char(3); prefix_value text;
begin
  if not public.has_permission(p_business_id, 'invoices.create') then raise exception 'not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then raise exception 'invalid invoice items' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and business_id = p_business_id) then raise exception 'client tenant mismatch' using errcode = '42501'; end if;
  select currency_code, invoice_prefix into currency_value, prefix_value from public.businesses where id = p_business_id;
  if currency_value is null then raise exception 'business not found' using errcode = '42501'; end if;
  insert into public.invoices(business_id, client_id, invoice_number, currency_code, due_date, notes)
  values (p_business_id, p_client_id, public.next_document_number(p_business_id, prefix_value), currency_value, p_due_date, nullif(trim(p_notes), '')) returning id into invoice_id;
  for item in select value from jsonb_array_elements(p_items) loop
    begin
      description_value := left(trim(item->>'description'), 500); quantity_value := (item->>'quantity')::numeric(19,4); unit_price_value := (item->>'unitPrice')::numeric(19,4);
      discount_value := coalesce((item->>'discountAmount')::numeric(19,4), 0); tax_rate_value := coalesce((item->>'taxRate')::numeric(7,4), 0);
    exception when others then raise exception 'invalid invoice item values' using errcode = '22023'; end;
    if description_value is null or description_value = '' or quantity_value <= 0 or unit_price_value < 0 or discount_value < 0 or tax_rate_value < 0 or tax_rate_value > 100 then raise exception 'invalid invoice item' using errcode = '22023'; end if;
    line_subtotal := round(quantity_value * unit_price_value, 4); if discount_value > line_subtotal then raise exception 'discount exceeds line subtotal' using errcode = '22023'; end if;
    line_tax := round((line_subtotal - discount_value) * tax_rate_value / 100, 4); line_total := line_subtotal - discount_value + line_tax;
    insert into public.invoice_items(business_id, invoice_id, description, quantity, unit_price, discount_amount, tax_rate, line_total) values (p_business_id, invoice_id, description_value, quantity_value, unit_price_value, discount_value, tax_rate_value, line_total);
    total_subtotal := total_subtotal + line_subtotal; total_discount := total_discount + discount_value; total_tax := total_tax + line_tax; total_amount := total_amount + line_total;
  end loop;
  update public.invoices set subtotal = total_subtotal, discount_total = total_discount, tax_total = total_tax, total = total_amount where id = invoice_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (p_business_id, invoice_id, 'draft', auth.uid());
  insert into public.activity_logs(business_id, actor_id, action, entity_type, entity_id) values (p_business_id, auth.uid(), 'invoice.created', 'invoice', invoice_id);
  return invoice_id;
end $$;

create or replace function public.send_invoice(p_invoice_id uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare target_business uuid; current_status public.invoice_status;
begin
  select business_id, status into target_business, current_status from public.invoices where id = p_invoice_id for update;
  if target_business is null or not public.has_permission(target_business, 'invoices.send') then raise exception 'not authorized' using errcode = '42501'; end if;
  if current_status <> 'draft' then raise exception 'only draft invoices can be sent' using errcode = '22023'; end if;
  update public.invoices set status = 'sent' where id = p_invoice_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (target_business, p_invoice_id, 'sent', auth.uid());
end $$;

create or replace function public.record_payment(p_invoice_id uuid, p_amount numeric(19,4), p_paid_at timestamptz, p_provider_reference text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare payment_id uuid; target_business uuid; total_value numeric(19,4); paid_value numeric(19,4); currency_value char(3);
begin
  select business_id, total, amount_paid, currency_code into target_business, total_value, paid_value, currency_value from public.invoices where id = p_invoice_id for update;
  if target_business is null or not public.has_permission(target_business, 'payments.create') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_amount <= 0 or paid_value + p_amount > total_value then raise exception 'invalid payment amount' using errcode = '22023'; end if;
  insert into public.payments(business_id, invoice_id, amount, currency_code, paid_at, provider_reference) values (target_business, p_invoice_id, p_amount, currency_value, coalesce(p_paid_at, now()), nullif(trim(p_provider_reference), '')) returning id into payment_id;
  update public.invoices set amount_paid = paid_value + p_amount, status = case when paid_value + p_amount = total_value then 'paid' else 'partial' end where id = p_invoice_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) select target_business, p_invoice_id, status, auth.uid() from public.invoices where id = p_invoice_id;
  insert into public.activity_logs(business_id, actor_id, action, entity_type, entity_id) values (target_business, auth.uid(), 'payment.recorded', 'payment', payment_id);
  return payment_id;
end $$;

create or replace function public.create_quote(p_business_id uuid, p_client_id uuid, p_expiry_date date, p_notes text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare quote_id uuid; item jsonb; line_subtotal numeric(19,4); line_discount numeric(19,4); line_tax numeric(19,4); line_total numeric(19,4);
declare total_subtotal numeric(19,4) := 0; total_discount numeric(19,4) := 0; total_tax numeric(19,4) := 0; total_amount numeric(19,4) := 0;
declare quantity_value numeric(19,4); unit_price_value numeric(19,4); discount_value numeric(19,4); tax_rate_value numeric(7,4); description_value text; currency_value char(3); prefix_value text;
begin
  if not public.has_permission(p_business_id, 'quotes.create') then raise exception 'not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then raise exception 'invalid quote items' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and business_id = p_business_id) then raise exception 'client tenant mismatch' using errcode = '42501'; end if;
  select currency_code, invoice_prefix into currency_value, prefix_value from public.businesses where id = p_business_id;
  insert into public.quotes(business_id, client_id, quote_number, currency_code, expiry_date, notes) values (p_business_id, p_client_id, public.next_document_number(p_business_id, 'Q-' || prefix_value), currency_value, p_expiry_date, nullif(trim(p_notes), '')) returning id into quote_id;
  for item in select value from jsonb_array_elements(p_items) loop
    begin description_value := left(trim(item->>'description'), 500); quantity_value := (item->>'quantity')::numeric(19,4); unit_price_value := (item->>'unitPrice')::numeric(19,4); discount_value := coalesce((item->>'discountAmount')::numeric(19,4), 0); tax_rate_value := coalesce((item->>'taxRate')::numeric(7,4), 0); exception when others then raise exception 'invalid quote item values' using errcode = '22023'; end;
    if description_value is null or description_value = '' or quantity_value <= 0 or unit_price_value < 0 or discount_value < 0 or discount_value > quantity_value * unit_price_value or tax_rate_value < 0 or tax_rate_value > 100 then raise exception 'invalid quote item' using errcode = '22023'; end if;
    line_subtotal := round(quantity_value * unit_price_value, 4); line_tax := round((line_subtotal - discount_value) * tax_rate_value / 100, 4); line_total := line_subtotal - discount_value + line_tax;
    insert into public.quote_items(business_id, quote_id, description, quantity, unit_price, discount_amount, tax_rate, line_total) values (p_business_id, quote_id, description_value, quantity_value, unit_price_value, discount_value, tax_rate_value, line_total);
    total_subtotal := total_subtotal + line_subtotal; total_discount := total_discount + discount_value; total_tax := total_tax + line_tax; total_amount := total_amount + line_total;
  end loop;
  update public.quotes set subtotal=total_subtotal, discount_total=total_discount, tax_total=total_tax, total=total_amount where id=quote_id;
  return quote_id;
end $$;

create or replace function public.convert_quote_to_invoice(p_quote_id uuid, p_due_date date) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare source_quote public.quotes%rowtype; invoice_id uuid; prefix_value text;
begin
  select * into source_quote from public.quotes where id = p_quote_id for update;
  if source_quote.id is null or not public.has_permission(source_quote.business_id, 'quotes.convert') then raise exception 'not authorized' using errcode = '42501'; end if;
  if source_quote.status not in ('draft','sent','accepted') or source_quote.converted_invoice_id is not null then raise exception 'quote cannot be converted' using errcode = '22023'; end if;
  select invoice_prefix into prefix_value from public.businesses where id = source_quote.business_id;
  insert into public.invoices(business_id, client_id, invoice_number, currency_code, due_date, notes, subtotal, discount_total, tax_total, total)
  values (source_quote.business_id, source_quote.client_id, public.next_document_number(source_quote.business_id, prefix_value), source_quote.currency_code, p_due_date, source_quote.notes, source_quote.subtotal, source_quote.discount_total, source_quote.tax_total, source_quote.total) returning id into invoice_id;
  insert into public.invoice_items(business_id, invoice_id, description, quantity, unit_price, discount_amount, tax_rate, line_total)
  select business_id, invoice_id, description, quantity, unit_price, discount_amount, tax_rate, line_total from public.quote_items where quote_id = p_quote_id;
  update public.quotes set status='converted', converted_invoice_id=invoice_id where id=p_quote_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (source_quote.business_id, invoice_id, 'draft', auth.uid());
  return invoice_id;
end $$;

revoke all on function public.create_invoice(uuid, uuid, date, text, jsonb), public.send_invoice(uuid), public.record_payment(uuid, numeric, timestamptz, text), public.create_quote(uuid, uuid, date, text, jsonb), public.convert_quote_to_invoice(uuid, date) from public;
grant execute on function public.create_invoice(uuid, uuid, date, text, jsonb), public.send_invoice(uuid), public.record_payment(uuid, numeric, timestamptz, text), public.create_quote(uuid, uuid, date, text, jsonb), public.convert_quote_to_invoice(uuid, date) to authenticated;
create trigger quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at();
