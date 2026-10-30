insert into public.permissions(code,description) values
 ('expenses.read','Read business expenses'),('expenses.create','Upload cost invoices'),('expenses.update','Update expense payment status');
insert into public.role_permissions(role,permission_code)
select r.role,p.code from (values ('admin'::public.business_role),('accountant'::public.business_role)) r(role)
cross join public.permissions p where p.code like 'expenses.%';
insert into public.role_permissions(role,permission_code) values('staff','expenses.create');

create table public.expenses (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete restrict,
 supplier text not null check(length(trim(supplier)) between 1 and 160),
 expense_date date not null, category text not null check(category in ('materials','travel','utilities','rent','software','professional_services','other')),
 description text not null default '' check(length(description)<=2000),
 amount numeric(19,4) not null check(amount>0 and amount<=1000000000),
 currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
 payment_status text not null check(payment_status in ('paid','unpaid')),
 invoice_reference text not null default '' check(length(invoice_reference)<=120),
 storage_path text not null, original_filename text not null check(length(original_filename) between 1 and 240),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,storage_path),
 check(public.storage_object_business_id(storage_path)=business_id)
);
create index expenses_business_date_idx on public.expenses(business_id,expense_date desc,created_at desc,id);
create index expenses_creator_date_idx on public.expenses(business_id,created_by,expense_date desc);
alter table public.expenses enable row level security;
grant select on public.expenses to authenticated;
grant all on public.expenses to service_role;
create policy expenses_read on public.expenses for select to authenticated using (
 public.has_permission(business_id,'expenses.read') or (created_by=(select auth.uid()) and public.has_permission(business_id,'expenses.create'))
);
create trigger expenses_updated_at before update on public.expenses for each row execute function public.set_updated_at();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('expense-invoices','expense-invoices',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp']);
create policy expense_invoice_upload on storage.objects for insert to authenticated with check (
 bucket_id='expense-invoices' and public.has_permission(public.storage_object_business_id(name),'expenses.create')
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'
);
create policy expense_invoice_read on storage.objects for select to authenticated using (
 bucket_id='expense-invoices' and (public.has_permission(public.storage_object_business_id(name),'expenses.read')
 or (owner_id=(select auth.uid())::text and public.has_permission(public.storage_object_business_id(name),'expenses.create')))
);

create function public.register_expense(p_business_id uuid,p_supplier text,p_expense_date date,p_category text,
 p_description text,p_amount numeric,p_currency text,p_status text,p_invoice_reference text,p_storage_path text,p_original_filename text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare object_metadata jsonb; object_owner text; expense_id uuid; existing_creator uuid; object_size bigint; object_type text;
begin
 if auth.uid() is null or not public.has_permission(p_business_id,'expenses.create') then raise exception 'not authorized' using errcode='42501'; end if;
 if p_storage_path is null or public.storage_object_business_id(p_storage_path) is distinct from p_business_id then raise exception 'expense tenant mismatch' using errcode='42501'; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>1000000000
  or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_amount<>round(p_amount,public.currency_decimals(p_currency))
  or p_expense_date is null or p_supplier is null or length(trim(p_supplier)) not between 1 and 160
  or p_category is null or p_category not in ('materials','travel','utilities','rent','software','professional_services','other')
  or p_status is null or p_status not in ('paid','unpaid') then raise exception 'invalid expense details' using errcode='22023'; end if;
 if p_original_filename is null or length(p_original_filename) not between 1 and 240 or p_original_filename ~ '[[:cntrl:]]'
  or position('/' in p_original_filename)>0 or position(chr(92) in p_original_filename)>0
  or p_original_filename !~* '\.(pdf|png|jpe?g|webp)$' then raise exception 'invalid invoice filename' using errcode='22023'; end if;
 select metadata,owner_id into object_metadata,object_owner from storage.objects where bucket_id='expense-invoices' and name=p_storage_path;
 if not found or object_owner is distinct from auth.uid()::text then raise exception 'invoice upload not authorized' using errcode='42501'; end if;
 object_size := (object_metadata->>'size')::bigint; object_type := object_metadata->>'mimetype';
 if object_size is null or object_size not between 1 and 10485760 or object_type is null
  or object_type not in ('application/pdf','image/png','image/jpeg','image/webp') then raise exception 'invalid invoice upload' using errcode='22023'; end if;
 insert into public.expenses(business_id,supplier,expense_date,category,description,amount,currency_code,payment_status,invoice_reference,
  storage_path,original_filename,mime_type,size_bytes,created_by)
 values(p_business_id,trim(p_supplier),p_expense_date,p_category,coalesce(p_description,''),p_amount,p_currency,p_status,coalesce(p_invoice_reference,''),
  p_storage_path,p_original_filename,object_type,object_size,auth.uid())
 on conflict(business_id,storage_path) do nothing returning id into expense_id;
 if expense_id is null then
  select id,created_by into expense_id,existing_creator from public.expenses where business_id=p_business_id and storage_path=p_storage_path;
  if existing_creator is distinct from auth.uid() then raise exception 'invoice already registered' using errcode='42501'; end if;
 end if;
 return expense_id;
end $$;
revoke all on function public.register_expense(uuid,text,date,text,text,numeric,text,text,text,text,text) from public,anon;
grant execute on function public.register_expense(uuid,text,date,text,text,numeric,text,text,text,text,text) to authenticated;

create function public.set_expense_status(p_business_id uuid,p_expense_id uuid,p_status text) returns void
language plpgsql security definer set search_path=public,auth as $$
declare expense public.expenses%rowtype;
begin
 select * into expense from public.expenses where id=p_expense_id and business_id=p_business_id for update;
 if auth.uid() is null or expense.id is null or not (public.has_permission(p_business_id,'expenses.update')
  or (expense.created_by=auth.uid() and public.has_permission(p_business_id,'expenses.create'))) then raise exception 'not authorized' using errcode='42501'; end if;
 if p_status is null or p_status not in ('paid','unpaid') then raise exception 'invalid payment status' using errcode='22023'; end if;
 update public.expenses set payment_status=p_status where id=expense.id;
end $$;
revoke all on function public.set_expense_status(uuid,uuid,text) from public,anon;
grant execute on function public.set_expense_status(uuid,uuid,text) to authenticated;

create function public.expense_summary(p_business_id uuid,p_query text default '',p_category text default '',p_status text default '') returns jsonb
language sql stable security invoker set search_path=public as $$
with visible as (
 select currency_code,amount,payment_status from public.expenses where business_id=p_business_id
 and supplier ilike '%'||coalesce(p_query,'')||'%'
 and (coalesce(p_category,'')='' or category=p_category) and (coalesce(p_status,'')='' or payment_status=p_status)
), totals as (
 select currency_code,sum(amount) as total,sum(case when payment_status='paid' then amount else 0 end) as paid,
 sum(case when payment_status='unpaid' then amount else 0 end) as unpaid from visible group by currency_code order by currency_code
)
select jsonb_build_object('count',(select count(*) from visible),'totals',coalesce((select jsonb_agg(totals) from totals),'[]'::jsonb));
$$;
revoke all on function public.expense_summary(uuid,text,text,text) from public,anon;
grant execute on function public.expense_summary(uuid,text,text,text) to authenticated;
