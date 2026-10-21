-- Growth features: configurable tax/country settings, public payment intents, invitations, and scheduled automation.
alter table public.businesses
  add column if not exists country_code char(2) not null default 'ZA' check (country_code ~ '^[A-Z]{2}$'),
  add column if not exists tax_name text not null default 'VAT' check (char_length(tax_name) between 2 and 40),
  add column if not exists default_tax_rate numeric(7,4) not null default 15 check (default_tax_rate between 0 and 100);

create type public.payment_intent_status as enum ('created', 'pending', 'paid', 'failed', 'cancelled');
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  provider text not null check (provider in ('paystack', 'flutterwave')),
  provider_reference text not null unique,
  expected_amount numeric(19,4) not null check (expected_amount > 0),
  currency_code char(3) not null,
  status public.payment_intent_status not null default 'created',
  provider_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (invoice_id, provider, provider_reference)
);
create index payment_intents_invoice_idx on public.payment_intents(invoice_id, created_at desc);
create trigger payment_intents_updated_at before update on public.payment_intents for each row execute function public.set_updated_at();

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (char_length(email) <= 254), role public.business_role not null default 'staff',
  invited_by uuid not null references auth.users(id), invited_at timestamptz not null default now(), accepted_at timestamptz,
  unique (business_id, email)
);
alter table public.business_invitations enable row level security;
create policy business_invitations_read on public.business_invitations for select to authenticated using (public.has_permission(business_id, 'users.manage'));
grant select on public.business_invitations to authenticated;

insert into public.permissions(code, description) values
  ('analytics.read', 'Read business analytics'), ('automation.manage', 'Manage scheduled automations')
on conflict do nothing;
insert into public.role_permissions(role, permission_code)
select 'admin'::public.business_role, code from public.permissions where code in ('analytics.read', 'automation.manage')
on conflict do nothing;
insert into public.role_permissions(role, permission_code) values ('accountant', 'analytics.read') on conflict do nothing;

-- The service role is used only by protected server/Edge jobs. Normal user permissions remain unchanged.
create or replace function public.has_permission(target_business uuid, required_permission text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select auth.role() = 'service_role' or exists (
    select 1 from public.business_users bu
    where bu.business_id = target_business and bu.user_id = auth.uid() and bu.status = 'active'
      and coalesce(
        (select bup.granted from public.business_user_permissions bup where bup.business_id = bu.business_id and bup.user_id = bu.user_id and bup.permission_code = required_permission),
        exists (select 1 from public.role_permissions rp where rp.role = bu.role and rp.permission_code = required_permission)
      )
  );
$$;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;

create or replace function public.activate_pending_memberships() returns integer
language plpgsql security definer set search_path = public, auth as $$
declare activated integer;
begin
  update public.business_users set status = 'active'
  where user_id = auth.uid() and status = 'invited';
  get diagnostics activated = row_count;
  return activated;
end $$;
revoke all on function public.activate_pending_memberships() from public;
grant execute on function public.activate_pending_memberships() to authenticated;

create or replace function public.create_payment_intent(p_invoice_id uuid, p_provider text, p_reference text) returns public.payment_intents
language plpgsql security definer set search_path = public, auth as $$
declare invoice_record public.invoices%rowtype; intent public.payment_intents%rowtype;
begin
  select * into invoice_record from public.invoices where id = p_invoice_id for update;
  if invoice_record.id is null or not public.has_permission(invoice_record.business_id, 'invoices.read') then raise exception 'not authorized' using errcode = '42501'; end if;
  if invoice_record.status in ('draft', 'void', 'paid') or invoice_record.total <= invoice_record.amount_paid then raise exception 'invoice is not payable' using errcode = '22023'; end if;
  insert into public.payment_intents(business_id, invoice_id, provider, provider_reference, expected_amount, currency_code, status)
  values (invoice_record.business_id, invoice_record.id, p_provider, p_reference, invoice_record.total - invoice_record.amount_paid, invoice_record.currency_code, 'pending')
  returning * into intent;
  return intent;
end $$;
revoke all on function public.create_payment_intent(uuid, text, text) from public;
grant execute on function public.create_payment_intent(uuid, text, text) to authenticated;
