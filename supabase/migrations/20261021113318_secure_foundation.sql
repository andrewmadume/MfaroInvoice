-- MfaroInvoice secure multi-tenant foundation. Apply with `supabase db push`.
create extension if not exists pgcrypto;

create type public.business_role as enum ('admin', 'accountant', 'staff');
create type public.invoice_status as enum ('draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void');

create table public.businesses (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'), currency_code char(3) not null default 'ZAR',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.business_users (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role public.business_role not null default 'staff',
  status text not null default 'active' check (status in ('active','invited','suspended')), created_at timestamptz not null default now(),
  unique(business_id,user_id)
);
create index business_users_user_business_idx on public.business_users(user_id,business_id) where status='active';

-- SECURITY DEFINER is intentionally narrow, has a fixed search path, and only reads memberships.
create or replace function public.is_active_member(target_business uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.business_users bu where bu.business_id=target_business and bu.user_id=auth.uid() and bu.status='active');
$$;
create or replace function public.has_business_role(target_business uuid, allowed public.business_role[]) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.business_users bu where bu.business_id=target_business and bu.user_id=auth.uid() and bu.status='active' and bu.role=any(allowed));
$$;
revoke all on function public.is_active_member(uuid), public.has_business_role(uuid, public.business_role[]) from public;
grant execute on function public.is_active_member(uuid), public.has_business_role(uuid, public.business_role[]) to authenticated;

create table public.clients (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, email text, phone text, tax_number text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(business_id,email)
);
create index clients_business_created_idx on public.clients(business_id,created_at desc);
create table public.products (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, sku text, unit_price numeric(19,4) not null check(unit_price>=0), tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100), created_at timestamptz not null default now(), unique(business_id,sku)
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict, invoice_number text not null,
  status public.invoice_status not null default 'draft', issue_date date not null default current_date, due_date date,
  currency_code char(3) not null, subtotal numeric(19,4) not null default 0 check(subtotal>=0), discount_total numeric(19,4) not null default 0 check(discount_total>=0), tax_total numeric(19,4) not null default 0 check(tax_total>=0), total numeric(19,4) not null default 0 check(total>=0), amount_paid numeric(19,4) not null default 0 check(amount_paid>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(business_id,invoice_number), check(amount_paid<=total)
);
create index invoices_business_status_idx on public.invoices(business_id,status,created_at desc);
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade, description text not null, quantity numeric(19,4) not null check(quantity>0), unit_price numeric(19,4) not null check(unit_price>=0), discount_amount numeric(19,4) not null default 0 check(discount_amount>=0), tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100), line_total numeric(19,4) not null check(line_total>=0)
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);
create table public.payments (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict, invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(19,4) not null check(amount>0), currency_code char(3) not null, paid_at timestamptz not null default now(), provider_reference text, created_at timestamptz not null default now(), unique(business_id,provider_reference)
);
create index payments_business_paid_idx on public.payments(business_id,paid_at desc);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade, actor_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Prevent cross-tenant references even if an authorized user tries to submit foreign UUIDs.
create or replace function public.assert_same_invoice_tenant() returns trigger language plpgsql security definer set search_path=public as $$
begin if not exists (select 1 from public.invoices i where i.id=new.invoice_id and i.business_id=new.business_id) then raise exception 'invoice tenant mismatch' using errcode='42501'; end if; return new; end $$;
create trigger invoice_item_tenant_guard before insert or update on public.invoice_items for each row execute function public.assert_same_invoice_tenant();
create or replace function public.assert_invoice_client_tenant() returns trigger language plpgsql security definer set search_path=public as $$
begin if not exists (select 1 from public.clients c where c.id=new.client_id and c.business_id=new.business_id) then raise exception 'client tenant mismatch' using errcode='42501'; end if; return new; end $$;
create trigger invoice_client_tenant_guard before insert or update on public.invoices for each row execute function public.assert_invoice_client_tenant();

alter table public.businesses enable row level security;
alter table public.business_users enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.activity_logs enable row level security;

create policy business_members_read on public.businesses for select to authenticated using (public.is_active_member(id));
create policy membership_read on public.business_users for select to authenticated using (public.is_active_member(business_id));
create policy membership_admin_write on public.business_users for all to authenticated using (public.has_business_role(business_id,array['admin']::public.business_role[])) with check (public.has_business_role(business_id,array['admin']::public.business_role[]));
create policy clients_member_access on public.clients for select to authenticated using (public.is_active_member(business_id));
create policy clients_staff_write on public.clients for all to authenticated using (public.has_business_role(business_id,array['admin','accountant','staff']::public.business_role[])) with check (public.has_business_role(business_id,array['admin','accountant','staff']::public.business_role[]));
create policy products_member_access on public.products for select to authenticated using (public.is_active_member(business_id));
create policy products_writer_access on public.products for all to authenticated using (public.has_business_role(business_id,array['admin','accountant']::public.business_role[])) with check (public.has_business_role(business_id,array['admin','accountant']::public.business_role[]));
create policy invoices_member_access on public.invoices for select to authenticated using (public.is_active_member(business_id));
create policy invoices_writer_access on public.invoices for all to authenticated using (public.has_business_role(business_id,array['admin','accountant']::public.business_role[])) with check (public.has_business_role(business_id,array['admin','accountant']::public.business_role[]));
create policy invoice_items_member_access on public.invoice_items for select to authenticated using (public.is_active_member(business_id));
create policy invoice_items_writer_access on public.invoice_items for all to authenticated using (public.has_business_role(business_id,array['admin','accountant']::public.business_role[])) with check (public.has_business_role(business_id,array['admin','accountant']::public.business_role[]));
create policy payments_member_access on public.payments for select to authenticated using (public.is_active_member(business_id));
create policy payments_writer_access on public.payments for insert to authenticated with check (public.has_business_role(business_id,array['admin','accountant']::public.business_role[]));
create policy logs_member_access on public.activity_logs for select to authenticated using (public.is_active_member(business_id));

-- Server-side onboarding calls this RPC after Auth registration. Clients cannot assign an owner.
create or replace function public.create_business(business_name text, business_slug text, currency char(3) default 'ZAR') returns uuid
language plpgsql security definer set search_path=public, auth as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  insert into public.businesses(name,slug,currency_code) values (business_name,business_slug,currency) returning id into created_id;
  insert into public.business_users(business_id,user_id,role,status) values (created_id,auth.uid(),'admin','active');
  return created_id;
end $$;
revoke all on function public.create_business(text,text,char) from public;
grant execute on function public.create_business(text,text,char) to authenticated;

-- Private storage: object path must be <business_id>/<opaque-file-name>.
insert into storage.buckets(id,name,public) values ('business-documents','business-documents',false) on conflict do nothing;
create policy document_read on storage.objects for select to authenticated using (bucket_id='business-documents' and public.is_active_member((storage.foldername(name))[1]::uuid));
create policy document_write on storage.objects for insert to authenticated with check (bucket_id='business-documents' and public.has_business_role((storage.foldername(name))[1]::uuid,array['admin','accountant','staff']::public.business_role[]));
