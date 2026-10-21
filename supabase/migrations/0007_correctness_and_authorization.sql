-- Repair invoicing, authorization and background operations without rewriting migration history.
alter table public.invoices add column if not exists notes text;
alter table public.invoice_status_history alter column changed_by drop not null;
alter table public.invoice_status_history add column actor_type text not null default 'user' check (actor_type in ('user','system'));
create or replace function public.guard_history_actor() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    if auth.role() is distinct from 'service_role' then raise exception 'actor required' using errcode='42501'; end if;
    new.actor_type := 'system'; new.changed_by := null;
  else new.actor_type := 'user'; new.changed_by := auth.uid(); end if;
  return new;
end $$;
revoke all on function public.guard_history_actor() from public;
create trigger history_actor_guard before insert on public.invoice_status_history for each row execute function public.guard_history_actor();

alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from anon, authenticated;
grant select on public.payment_intents to authenticated;
grant all on public.payment_intents to service_role;
create policy payment_intents_read on public.payment_intents for select to authenticated using (public.has_permission(business_id,'invoices.read'));
revoke insert, update, delete on public.business_users, public.business_user_permissions from authenticated;
drop policy business_membership_insert on public.business_users;
drop policy business_membership_update on public.business_users;
drop policy business_membership_delete on public.business_users;
drop policy user_permissions_insert on public.business_user_permissions;
drop policy user_permissions_update on public.business_user_permissions;
drop policy user_permissions_delete on public.business_user_permissions;
revoke update on public.businesses from authenticated;
grant update(name,legal_name,email,phone,address,tax_number,invoice_prefix,country_code,tax_name,default_tax_rate) on public.businesses to authenticated;
revoke insert, update on public.products from authenticated;
grant insert(business_id,name,sku,unit_price,tax_rate), update(name,sku,unit_price,tax_rate) on public.products to authenticated;

-- Composite tenant references also protect direct REST writes.
alter table public.clients add constraint clients_business_id_id_unique unique (business_id,id);
alter table public.projects add constraint projects_client_tenant foreign key (business_id,client_id) references public.clients(business_id,id) not valid;
-- NOT VALID preserves legacy rows while preventing new invalid links. Repair any old links
-- before VALIDATE CONSTRAINT, rather than silently reassigning financial records.

create or replace function public.currency_decimals(p_currency text) returns integer
language sql immutable set search_path=public as $$
select case when p_currency in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0
when p_currency in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3 else 2 end;
$$;
revoke all on function public.currency_decimals(text) from public;
grant execute on function public.currency_decimals(text) to authenticated,service_role;

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
  update public.invoices set subtotal = total_subtotal, discount_total = total_discount, tax_total = total_tax, total = round(total_amount, public.currency_decimals(currency_value)) where id = invoice_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (p_business_id, invoice_id, 'draft', auth.uid());
  insert into public.activity_logs(business_id, actor_id, action, entity_type, entity_id) values (p_business_id, auth.uid(), 'invoice.created', 'invoice', invoice_id);
  return invoice_id;
end $$;

create or replace function public.convert_quote_to_invoice(p_quote_id uuid, p_due_date date) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare source_quote public.quotes%rowtype; invoice_id uuid; prefix_value text;
begin
  select * into source_quote from public.quotes where id = p_quote_id for update;
  if source_quote.id is null or not public.has_permission(source_quote.business_id, 'quotes.convert') then raise exception 'not authorized' using errcode = '42501'; end if;
  if source_quote.status not in ('draft','sent','accepted') or source_quote.converted_invoice_id is not null then raise exception 'quote cannot be converted' using errcode = '22023'; end if;
  select invoice_prefix into prefix_value from public.businesses where id = source_quote.business_id;
  insert into public.invoices(business_id, client_id, invoice_number, currency_code, due_date, notes, subtotal, discount_total, tax_total, total)
  values (source_quote.business_id, source_quote.client_id, public.next_document_number(source_quote.business_id, prefix_value), source_quote.currency_code, p_due_date, source_quote.notes, source_quote.subtotal, source_quote.discount_total, source_quote.tax_total, round(source_quote.total, public.currency_decimals(source_quote.currency_code))) returning id into invoice_id;
  insert into public.invoice_items(business_id, invoice_id, description, quantity, unit_price, discount_amount, tax_rate, line_total)
  select business_id, invoice_id, description, quantity, unit_price, discount_amount, tax_rate, line_total from public.quote_items where quote_id = p_quote_id;
  update public.quotes set status='converted', converted_invoice_id=invoice_id where id=p_quote_id;
  insert into public.invoice_status_history(business_id, invoice_id, status, changed_by) values (source_quote.business_id, invoice_id, 'draft', auth.uid());
  return invoice_id;
end $$;
create or replace function public.record_payment(p_invoice_id uuid, p_amount numeric, p_paid_at timestamptz, p_provider_reference text) returns uuid
language plpgsql security definer set search_path=public,auth as $$
declare invoice_record public.invoices%rowtype; payment_id uuid; existing public.payments%rowtype;
begin
  select * into invoice_record from public.invoices where id=p_invoice_id for update;
  if invoice_record.id is null or not public.has_permission(invoice_record.business_id,'payments.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if nullif(trim(p_provider_reference),'') is not null then
    select * into existing from public.payments where business_id=invoice_record.business_id and provider_reference=trim(p_provider_reference);
    if existing.id is not null then
      if existing.invoice_id<>p_invoice_id or existing.amount<>p_amount then raise exception 'reference conflict' using errcode='22023'; end if;
      return existing.id;
    end if;
  end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or invoice_record.status in ('draft','void') or invoice_record.amount_paid+p_amount>invoice_record.total then raise exception 'invalid payment' using errcode='22023'; end if;
  insert into public.payments(business_id,invoice_id,amount,currency_code,paid_at,provider_reference)
  values(invoice_record.business_id,p_invoice_id,p_amount,invoice_record.currency_code,coalesce(p_paid_at,now()),nullif(trim(p_provider_reference),'')) returning id into payment_id;
  update public.invoices set amount_paid=amount_paid+p_amount,status=(case when amount_paid+p_amount=total then 'paid' else 'partial' end)::public.invoice_status where id=p_invoice_id;
  insert into public.invoice_status_history(business_id,invoice_id,status,changed_by) select business_id,id,status,auth.uid() from public.invoices where id=p_invoice_id;
  update public.invoice_reminders set status='cancelled' where invoice_id=p_invoice_id and status='pending' and invoice_record.amount_paid+p_amount=invoice_record.total;
  insert into public.activity_logs(business_id,actor_id,action,entity_type,entity_id) values(invoice_record.business_id,auth.uid(),'payment.recorded','payment',payment_id);
  return payment_id;
end $$;

create or replace function public.create_payment_intent(p_invoice_id uuid, p_provider text, p_reference text) returns public.payment_intents
language plpgsql security definer set search_path = public, auth as $$
declare invoice_record public.invoices%rowtype; intent public.payment_intents%rowtype;
begin
  select * into invoice_record from public.invoices where id = p_invoice_id for update;
  if invoice_record.id is null or not public.has_permission(invoice_record.business_id, 'invoices.read') then raise exception 'not authorized' using errcode = '42501'; end if;
  if invoice_record.status in ('draft', 'void', 'paid') or invoice_record.total <= invoice_record.amount_paid then raise exception 'invoice is not payable' using errcode = '22023'; end if;
  if not exists(select 1 from public.payment_provider_configs where business_id=invoice_record.business_id and provider=p_provider and enabled) then raise exception 'provider disabled' using errcode='22023'; end if;
  if round(invoice_record.total-invoice_record.amount_paid,public.currency_decimals(invoice_record.currency_code)) <> invoice_record.total-invoice_record.amount_paid then raise exception 'legacy balance needs currency precision reconciliation before online payment' using errcode='22023'; end if;
  insert into public.payment_intents(business_id, invoice_id, provider, provider_reference, expected_amount, currency_code, status)
  values (invoice_record.business_id, invoice_record.id, p_provider, p_reference, invoice_record.total - invoice_record.amount_paid, invoice_record.currency_code, 'pending')
  returning * into intent;
  return intent;
end $$;

create or replace function public.finalize_provider_payment(p_provider text,p_reference text,p_amount numeric,p_currency text,p_paid_at timestamptz default null) returns uuid
language plpgsql security definer set search_path=public,auth as $$
declare intent public.payment_intents%rowtype; payment_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into intent from public.payment_intents where provider=p_provider and provider_reference=p_reference;
  if intent.id is null then raise exception 'unknown payment' using errcode='22023'; end if;
  -- All settlement paths take the invoice lock before the intent lock.
  perform 1 from public.invoices where id=intent.invoice_id for update;
  select * into intent from public.payment_intents where id=intent.id for update;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or intent.expected_amount<>p_amount or intent.currency_code<>p_currency then raise exception 'payment mismatch' using errcode='22023'; end if;
  if intent.status='paid' then select id into payment_id from public.payments where business_id=intent.business_id and provider_reference=p_reference; return payment_id; end if;
  if intent.status<>'pending' then raise exception 'payment not pending' using errcode='22023'; end if;
  payment_id:=public.record_payment(intent.invoice_id,p_amount,p_paid_at,p_reference);
  update public.payment_intents set status='paid',paid_at=coalesce(p_paid_at,now()) where id=intent.id;
  return payment_id;
end $$;
revoke all on function public.finalize_provider_payment(text,text,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finalize_provider_payment(text,text,numeric,text,timestamptz) to service_role;
grant execute on function public.record_payment(uuid,numeric,timestamptz,text),public.create_invoice(uuid,uuid,date,text,jsonb) to service_role;

create or replace function public.run_recurring_invoice(p_recurring_id uuid) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare recurring public.recurring_invoices%rowtype; invoice_id uuid; item_payload jsonb; next_date date;
begin
  select * into recurring from public.recurring_invoices where id = p_recurring_id for update;
  if recurring.id is null or not recurring.active or not public.has_permission(recurring.business_id, 'recurring.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if auth.role()='service_role' and recurring.next_run_date>current_date then return null; end if;
  select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unitPrice', unit_price, 'discountAmount', discount_amount, 'taxRate', tax_rate)) into item_payload from public.recurring_invoice_items where recurring_invoice_id = recurring.id;
  invoice_id := public.create_invoice(recurring.business_id, recurring.client_id, recurring.next_run_date + recurring.due_days, recurring.notes, item_payload);
  next_date := case recurring.frequency when 'weekly' then recurring.next_run_date + 7 when 'monthly' then recurring.next_run_date + interval '1 month' when 'quarterly' then recurring.next_run_date + interval '3 months' else recurring.next_run_date + interval '1 year' end;
  update public.recurring_invoices set next_run_date = next_date, last_run_at = now() where id = recurring.id;
  return invoice_id;
end $$;
grant execute on function public.run_recurring_invoice(uuid) to service_role;

create or replace function public.manage_business_user_access(
  p_business_id uuid,
  p_user_id uuid,
  p_role public.business_role,
  p_permission_overrides jsonb default '[]'::jsonb
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare item jsonb; permission_code_value text; granted_value boolean; current_role public.business_role;
begin
  if not public.has_permission(p_business_id, 'users.manage') or not public.has_aal2() then
    raise exception 'not authorized or MFA step-up required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'you cannot change your own access' using errcode = '22023'; end if;
  if jsonb_typeof(p_permission_overrides) <> 'array' or jsonb_array_length(p_permission_overrides) > 50 then
    raise exception 'invalid permission overrides' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id=p_business_id for update;
  select role into current_role from public.business_users where business_id = p_business_id and user_id = p_user_id and status = 'active' for update;
  if current_role is null then raise exception 'active member not found' using errcode = '22023'; end if;
  if current_role = 'admin' and p_role <> 'admin' and (select count(*) from public.business_users where business_id = p_business_id and status = 'active' and role = 'admin') <= 1 then
    raise exception 'a business must retain one admin' using errcode = '22023';
  end if;
  update public.business_users set role = p_role where business_id = p_business_id and user_id = p_user_id;
  delete from public.business_user_permissions where business_id = p_business_id and user_id = p_user_id;
  for item in select value from jsonb_array_elements(p_permission_overrides) loop
    permission_code_value := item ->> 'code';
    granted_value := (item ->> 'granted')::boolean;
    if permission_code_value is null or not exists (select 1 from public.permissions where code = permission_code_value) then
      raise exception 'unknown permission' using errcode = '22023';
    end if;
    insert into public.business_user_permissions(business_id, user_id, permission_code, granted)
    values (p_business_id, p_user_id, permission_code_value, granted_value);
  end loop;
  insert into public.activity_logs(business_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_business_id, auth.uid(), 'users.access_updated', 'business_user', p_user_id, jsonb_build_object('role', p_role));
end $$;

-- A lease and provider idempotency key allow safe overlapping/retried dispatches.
alter table public.invoice_reminders add column claim_token uuid, add column claimed_until timestamptz, add column first_attempt_at timestamptz;
create or replace function public.claim_invoice_reminders() returns setof public.invoice_reminders
language plpgsql security definer set search_path=public,auth as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  update public.invoice_reminders r set status='cancelled' from public.invoices i where r.invoice_id=i.id and r.status='pending' and (i.status in ('paid','void','draft') or i.total<=i.amount_paid);
  update public.invoice_reminders set status='failed' where status='pending' and first_attempt_at<now()-interval '23 hours';
  return query with due as (
    select r.id from public.invoice_reminders r join public.invoices i on i.id=r.invoice_id
    where r.status='pending' and r.scheduled_for<=now() and (r.claimed_until is null or r.claimed_until<now())
      and i.status in ('sent','viewed','partial','overdue') and i.total>i.amount_paid and r.attempt_count<10
    order by r.scheduled_for for update of r skip locked limit 100
  ) update public.invoice_reminders r set first_attempt_at=coalesce(r.first_attempt_at,now()),claim_token=gen_random_uuid(),claimed_until=now()+interval '5 minutes',attempt_count=attempt_count+1
    from due where r.id=due.id returning r.*;
end $$;
revoke all on function public.claim_invoice_reminders() from public,anon,authenticated;
grant execute on function public.claim_invoice_reminders() to service_role;

-- Totals aggregate in the database, beyond the REST response row limit.
create or replace function public.financial_summary(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,auth as $$
declare result jsonb;
begin
  if not public.has_permission(p_business_id,'reports.read') and not public.has_permission(p_business_id,'analytics.read') then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object('invoiced',coalesce(sum(total),0),'outstanding',coalesce(sum(total-amount_paid),0),
    'overdue',coalesce(sum(total-amount_paid) filter(where due_date<current_date),0),
    'tax',coalesce(sum(tax_total),0),'month',coalesce(sum(total) filter(where issue_date>=date_trunc('month',current_date)::date and issue_date<=current_date),0))
  into result from public.invoices where business_id=p_business_id and status in ('sent','viewed','partial','overdue','paid');
  return result||jsonb_build_object('topClients',(select coalesce(jsonb_agg(t),'[]'::jsonb) from (select c.id,c.name,sum(i.total) as invoiced,sum(i.amount_paid) as collected from public.invoices i join public.clients c on c.id=i.client_id where i.business_id=p_business_id and i.status in ('sent','viewed','partial','overdue','paid') group by c.id,c.name order by sum(i.total) desc,c.id limit 5) t),'collected',(select coalesce(sum(amount),0) from public.payments where business_id=p_business_id));
end $$;
revoke all on function public.financial_summary(uuid) from public;
grant execute on function public.financial_summary(uuid) to authenticated;
