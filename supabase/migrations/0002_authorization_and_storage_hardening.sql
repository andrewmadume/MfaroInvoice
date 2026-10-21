-- Security hardening: apply after 0001_secure_foundation.sql.
-- This migration replaces coarse role policies with explicit permissions.

create table public.permissions (
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);
create table public.role_permissions (
  role public.business_role not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role, permission_code)
);
create table public.business_user_permissions (
  business_id uuid not null,
  user_id uuid not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted boolean not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id, permission_code),
  foreign key (business_id, user_id) references public.business_users(business_id, user_id) on delete cascade
);

insert into public.permissions (code, description) values
  ('clients.read','Read clients'), ('clients.create','Create clients'), ('clients.update','Update clients'), ('clients.delete','Delete clients'),
  ('products.read','Read products'), ('products.create','Create products'), ('products.update','Update products'), ('products.delete','Delete products'),
  ('invoices.read','Read invoices'), ('invoices.create','Create invoices'), ('invoices.update','Update invoices'), ('invoices.delete','Delete invoices'),
  ('payments.read','Read payments'), ('payments.create','Record payments'), ('documents.read','Read documents'), ('documents.create','Upload documents'),
  ('documents.update','Update documents'), ('documents.delete','Delete documents'), ('users.manage','Manage users'), ('settings.manage','Manage business settings'),
  ('audit.read','Read audit logs')
on conflict do nothing;

insert into public.role_permissions (role, permission_code)
select 'admin'::public.business_role, code from public.permissions
on conflict do nothing;
insert into public.role_permissions (role, permission_code) values
  ('accountant','clients.read'), ('accountant','clients.create'), ('accountant','clients.update'),
  ('accountant','products.read'), ('accountant','products.create'), ('accountant','products.update'),
  ('accountant','invoices.read'), ('accountant','invoices.create'), ('accountant','invoices.update'),
  ('accountant','payments.read'), ('accountant','payments.create'), ('accountant','documents.read'), ('accountant','documents.create'), ('accountant','audit.read'),
  ('staff','clients.read'), ('staff','clients.create'), ('staff','clients.update'), ('staff','products.read'), ('staff','invoices.read'), ('staff','documents.read'), ('staff','documents.create')
on conflict do nothing;

create or replace function public.has_permission(target_business uuid, required_permission text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.business_users bu
    where bu.business_id = target_business and bu.user_id = auth.uid() and bu.status = 'active'
      and coalesce(
        (select bup.granted from public.business_user_permissions bup where bup.business_id = bu.business_id and bup.user_id = bu.user_id and bup.permission_code = required_permission),
        exists (select 1 from public.role_permissions rp where rp.role = bu.role and rp.permission_code = required_permission)
      )
  );
$$;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.has_permission(uuid, text) to authenticated;
revoke all on function public.assert_same_invoice_tenant(), public.assert_invoice_client_tenant() from public;

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.business_user_permissions enable row level security;
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy user_permissions_read on public.business_user_permissions for select to authenticated using (user_id = auth.uid() or public.has_permission(business_id, 'users.manage'));
create policy user_permissions_insert on public.business_user_permissions for insert to authenticated with check (public.has_permission(business_id, 'users.manage'));
create policy user_permissions_update on public.business_user_permissions for update to authenticated using (public.has_permission(business_id, 'users.manage')) with check (public.has_permission(business_id, 'users.manage'));
create policy user_permissions_delete on public.business_user_permissions for delete to authenticated using (public.has_permission(business_id, 'users.manage'));

drop policy membership_read on public.business_users;
drop policy membership_admin_write on public.business_users;
drop policy clients_member_access on public.clients;
drop policy clients_staff_write on public.clients;
drop policy products_member_access on public.products;
drop policy products_writer_access on public.products;
drop policy invoices_member_access on public.invoices;
drop policy invoices_writer_access on public.invoices;
drop policy invoice_items_member_access on public.invoice_items;
drop policy invoice_items_writer_access on public.invoice_items;
drop policy payments_member_access on public.payments;
drop policy payments_writer_access on public.payments;
drop policy logs_member_access on public.activity_logs;

create policy business_membership_read on public.business_users for select to authenticated using (user_id = auth.uid() or public.has_permission(business_id, 'users.manage'));
create policy business_membership_insert on public.business_users for insert to authenticated with check (public.has_permission(business_id, 'users.manage'));
create policy business_membership_update on public.business_users for update to authenticated using (public.has_permission(business_id, 'users.manage')) with check (public.has_permission(business_id, 'users.manage'));
create policy business_membership_delete on public.business_users for delete to authenticated using (public.has_permission(business_id, 'users.manage'));
create policy business_update on public.businesses for update to authenticated using (public.has_permission(id, 'settings.manage')) with check (public.has_permission(id, 'settings.manage'));

create policy clients_read on public.clients for select to authenticated using (public.has_permission(business_id, 'clients.read'));
create policy clients_insert on public.clients for insert to authenticated with check (public.has_permission(business_id, 'clients.create'));
create policy clients_update on public.clients for update to authenticated using (public.has_permission(business_id, 'clients.update')) with check (public.has_permission(business_id, 'clients.update'));
create policy clients_delete on public.clients for delete to authenticated using (public.has_permission(business_id, 'clients.delete'));
create policy products_read on public.products for select to authenticated using (public.has_permission(business_id, 'products.read'));
create policy products_insert on public.products for insert to authenticated with check (public.has_permission(business_id, 'products.create'));
create policy products_update on public.products for update to authenticated using (public.has_permission(business_id, 'products.update')) with check (public.has_permission(business_id, 'products.update'));
create policy products_delete on public.products for delete to authenticated using (public.has_permission(business_id, 'products.delete'));
create policy invoices_read on public.invoices for select to authenticated using (public.has_permission(business_id, 'invoices.read'));
create policy invoices_insert on public.invoices for insert to authenticated with check (public.has_permission(business_id, 'invoices.create'));
create policy invoices_update on public.invoices for update to authenticated using (public.has_permission(business_id, 'invoices.update')) with check (public.has_permission(business_id, 'invoices.update'));
create policy invoices_delete on public.invoices for delete to authenticated using (public.has_permission(business_id, 'invoices.delete'));
create policy invoice_items_read on public.invoice_items for select to authenticated using (public.has_permission(business_id, 'invoices.read'));
create policy invoice_items_insert on public.invoice_items for insert to authenticated with check (public.has_permission(business_id, 'invoices.create'));
create policy invoice_items_update on public.invoice_items for update to authenticated using (public.has_permission(business_id, 'invoices.update')) with check (public.has_permission(business_id, 'invoices.update'));
create policy invoice_items_delete on public.invoice_items for delete to authenticated using (public.has_permission(business_id, 'invoices.delete'));
create policy payments_read on public.payments for select to authenticated using (public.has_permission(business_id, 'payments.read'));
create policy payments_insert on public.payments for insert to authenticated with check (public.has_permission(business_id, 'payments.create'));
create policy logs_read on public.activity_logs for select to authenticated using (public.has_permission(business_id, 'audit.read'));

grant select, insert, update, delete on public.businesses, public.business_users, public.clients, public.products, public.invoices, public.invoice_items, public.payments, public.activity_logs, public.business_user_permissions to authenticated;
grant select on public.permissions, public.role_permissions to authenticated;

create or replace function public.assert_payment_tenant() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.invoices i where i.id = new.invoice_id and i.business_id = new.business_id) then
    raise exception 'payment invoice tenant mismatch' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.assert_payment_tenant() from public;
create trigger payment_tenant_guard before insert or update on public.payments for each row execute function public.assert_payment_tenant();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null, original_filename text not null check (original_filename ~* '\.(pdf|png|jpe?g|csv|xlsx)$'),
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique (business_id, storage_path)
);
create or replace function public.storage_object_business_id(object_name text) returns uuid
language plpgsql immutable security invoker set search_path = '' as $$
declare folder text;
begin
  folder := split_part(object_name, '/', 1);
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+' then return null; end if;
  return folder::uuid;
end $$;
revoke all on function public.storage_object_business_id(text) from public;
grant execute on function public.storage_object_business_id(text) to authenticated;
create or replace function public.assert_document_tenant() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.storage_object_business_id(new.storage_path) is distinct from new.business_id then raise exception 'document tenant path mismatch' using errcode='42501'; end if;
  if new.created_by <> auth.uid() then raise exception 'document creator mismatch' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function public.assert_document_tenant() from public;
create trigger document_tenant_guard before insert or update on public.documents for each row execute function public.assert_document_tenant();
alter table public.documents enable row level security;
create policy documents_read on public.documents for select to authenticated using (public.has_permission(business_id, 'documents.read'));
create policy documents_insert on public.documents for insert to authenticated with check (public.has_permission(business_id, 'documents.create'));
create policy documents_update on public.documents for update to authenticated using (public.has_permission(business_id, 'documents.update')) with check (public.has_permission(business_id, 'documents.update'));
create policy documents_delete on public.documents for delete to authenticated using (public.has_permission(business_id, 'documents.delete'));
grant select, insert, update, delete on public.documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-documents', 'business-documents', false, 10485760, array['application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy document_read on storage.objects;
drop policy document_write on storage.objects;
create policy document_read on storage.objects for select to authenticated using (bucket_id = 'business-documents' and public.has_permission(public.storage_object_business_id(name), 'documents.read'));
create policy document_write on storage.objects for insert to authenticated with check (bucket_id = 'business-documents' and public.has_permission(public.storage_object_business_id(name), 'documents.create'));
create policy document_update on storage.objects for update to authenticated using (bucket_id = 'business-documents' and public.has_permission(public.storage_object_business_id(name), 'documents.update')) with check (bucket_id = 'business-documents' and public.has_permission(public.storage_object_business_id(name), 'documents.update'));
create policy document_delete on storage.objects for delete to authenticated using (bucket_id = 'business-documents' and public.has_permission(public.storage_object_business_id(name), 'documents.delete'));

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
revoke all on function public.set_updated_at() from public;
create trigger businesses_updated_at before update on public.businesses for each row execute function public.set_updated_at();
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
