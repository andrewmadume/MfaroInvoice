-- Phase 4: step-up authentication, granular member administration, and safe offline sync.
alter table public.businesses add column if not exists mfa_required boolean not null default false;

create type public.sync_operation_status as enum ('processing', 'applied');
create table public.sync_operations (
  client_operation_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_type text not null check (operation_type in ('time_entry.create', 'inventory.adjust')),
  payload jsonb not null,
  status public.sync_operation_status not null default 'processing',
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index sync_operations_business_user_idx on public.sync_operations(business_id, user_id, created_at desc);

insert into public.permissions(code, description) values
  ('security.manage', 'Manage MFA security policy'), ('sync.read', 'Read sync activity'), ('sync.write', 'Synchronize queued work')
on conflict do nothing;
insert into public.role_permissions(role, permission_code)
select 'admin'::public.business_role, code from public.permissions where code in ('security.manage', 'sync.read', 'sync.write')
on conflict do nothing;
insert into public.role_permissions(role, permission_code) values
  ('accountant', 'sync.read'), ('accountant', 'sync.write'), ('staff', 'sync.read'), ('staff', 'sync.write')
on conflict do nothing;

alter table public.sync_operations enable row level security;
create policy sync_operations_read on public.sync_operations for select to authenticated
  using (user_id = auth.uid() and public.has_permission(business_id, 'sync.read'));
grant select on public.sync_operations to authenticated;

create or replace function public.has_aal2() returns boolean
language sql stable security definer set search_path = auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
revoke all on function public.has_aal2() from public;
grant execute on function public.has_aal2() to authenticated;

create or replace function public.set_business_mfa_requirement(p_business_id uuid, p_required boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.has_permission(p_business_id, 'security.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.has_aal2() then
    raise exception 'MFA step-up required' using errcode = '42501';
  end if;
  update public.businesses set mfa_required = p_required where id = p_business_id;
  if not found then raise exception 'business not found' using errcode = '42501'; end if;
  insert into public.activity_logs(business_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_business_id, auth.uid(), 'security.mfa_policy_updated', 'business', p_business_id, jsonb_build_object('mfa_required', p_required));
end $$;
revoke all on function public.set_business_mfa_requirement(uuid, boolean) from public;
grant execute on function public.set_business_mfa_requirement(uuid, boolean) to authenticated;

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
revoke all on function public.manage_business_user_access(uuid, uuid, public.business_role, jsonb) from public;
grant execute on function public.manage_business_user_access(uuid, uuid, public.business_role, jsonb) to authenticated;

create or replace function public.apply_sync_operation(
  p_business_id uuid,
  p_client_operation_id uuid,
  p_operation_type text,
  p_payload jsonb
) returns public.sync_operation_status
language plpgsql security definer set search_path = public, auth as $$
declare existing_status public.sync_operation_status; project_id_value uuid; product_id_value uuid; entry_date_value date;
  minutes_value integer; description_value text; billable_value boolean; quantity_delta_value numeric(19,4); reason_value public.inventory_reason; note_value text;
begin
  if auth.uid() is null or not public.has_permission(p_business_id, 'sync.write') then raise exception 'not authorized' using errcode = '42501'; end if;
  select status into existing_status from public.sync_operations
  where client_operation_id = p_client_operation_id and business_id = p_business_id and user_id = auth.uid();
  if existing_status is not null then return existing_status; end if;
  if exists (select 1 from public.sync_operations where client_operation_id = p_client_operation_id) then
    raise exception 'sync operation identifier conflict' using errcode = '22023';
  end if;
  if p_operation_type not in ('time_entry.create', 'inventory.adjust') or jsonb_typeof(p_payload) <> 'object' then raise exception 'unsupported sync operation' using errcode = '22023'; end if;
  insert into public.sync_operations(client_operation_id, business_id, user_id, operation_type, payload)
  values (p_client_operation_id, p_business_id, auth.uid(), p_operation_type, '{}'::jsonb);
  if p_operation_type = 'time_entry.create' then
    project_id_value := (p_payload ->> 'projectId')::uuid;
    entry_date_value := (p_payload ->> 'entryDate')::date;
    minutes_value := (p_payload ->> 'minutes')::integer;
    description_value := left(trim(p_payload ->> 'description'), 500);
    billable_value := coalesce((p_payload ->> 'billable')::boolean, true);
    if not public.has_permission(p_business_id, 'time.create') or minutes_value not between 1 and 1440 or description_value is null or description_value = '' then raise exception 'invalid time entry' using errcode = '22023'; end if;
    insert into public.time_entries(business_id, project_id, user_id, entry_date, minutes, description, billable)
    values (p_business_id, project_id_value, auth.uid(), entry_date_value, minutes_value, description_value, billable_value);
    update public.sync_operations set payload = jsonb_build_object('projectId', project_id_value, 'entryDate', entry_date_value, 'minutes', minutes_value, 'description', description_value, 'billable', billable_value), status = 'applied', applied_at = now() where client_operation_id = p_client_operation_id;
  else
    product_id_value := (p_payload ->> 'productId')::uuid;
    quantity_delta_value := (p_payload ->> 'quantityDelta')::numeric(19,4);
    reason_value := (p_payload ->> 'reason')::public.inventory_reason;
    note_value := left(trim(coalesce(p_payload ->> 'note', '')), 500);
    if not public.has_permission(p_business_id, 'inventory.adjust') or quantity_delta_value = 0 then raise exception 'invalid inventory adjustment' using errcode = '22023'; end if;
    perform public.adjust_inventory(p_business_id, product_id_value, quantity_delta_value, reason_value, note_value);
    update public.sync_operations set payload = jsonb_build_object('productId', product_id_value, 'quantityDelta', quantity_delta_value, 'reason', reason_value, 'note', nullif(note_value, '')), status = 'applied', applied_at = now() where client_operation_id = p_client_operation_id;
  end if;
  return 'applied';
end $$;
revoke all on function public.apply_sync_operation(uuid, uuid, text, jsonb) from public;
grant execute on function public.apply_sync_operation(uuid, uuid, text, jsonb) to authenticated;
