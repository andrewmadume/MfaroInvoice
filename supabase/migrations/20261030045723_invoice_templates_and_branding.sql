-- Branding is tenant-owned. Financial documents keep an immutable creation snapshot.
create function public.valid_invoice_design(design jsonb, business_id uuid) returns boolean
language plpgsql immutable security invoker set search_path=public as $$
declare entry record;
begin
  if jsonb_typeof(design) is distinct from 'object' then return false; end if;
  for entry in select * from jsonb_each(design) loop
    if entry.key not in ('template','accent','background','bankName','accountName','accountNumber','branchCode','accountType','swiftCode','paymentInstructions','terms','footer','website','logoPath')
      or jsonb_typeof(entry.value) is distinct from 'string' or length(entry.value #>> '{}') > 2000 then return false; end if;
  end loop;
  return coalesce(design->>'template','classic') in ('classic','minimal')
    and coalesce(design->>'accent','#1155cc') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(design->>'background','#ffffff') ~ '^#[0-9a-fA-F]{6}$'
    and (coalesce(design->>'logoPath','') = '' or design->>'logoPath' ~ ('^' || business_id::text || '/[0-9a-f-]{36}\.png$'));
end $$;
revoke all on function public.valid_invoice_design(jsonb,uuid) from public,anon;
grant execute on function public.valid_invoice_design(jsonb,uuid) to authenticated,service_role;

alter table public.businesses
  add column invoice_design jsonb not null default '{"template":"classic","accent":"#1155cc","background":"#ffffff"}',
  add column invoice_number_format text not null default '{prefix}-{number}',
  add column invoice_number_digits integer not null default 6 check(invoice_number_digits between 3 and 10),
  add constraint business_invoice_design_valid check(public.valid_invoice_design(invoice_design,id)),
  add constraint business_invoice_number_format_valid check(
    length(invoice_number_format) <= 80
    and length(invoice_number_format)-length(replace(invoice_number_format,'{number}','')) = 8
    and regexp_replace(invoice_number_format,'\{(prefix|year|month|number)\}','','g') ~ '^[A-Za-z0-9 /_-]*$'
  );
grant update(invoice_design,invoice_number_format,invoice_number_digits) on public.businesses to authenticated;

create or replace function public.next_document_number(target_business uuid, document_prefix text) returns text
language plpgsql security definer set search_path=public as $$
declare sequence_value bigint; settings public.businesses%rowtype; formatted text; number_text text;
begin
  select * into strict settings from public.businesses where id=target_business;
  insert into public.invoice_sequences(business_id) values(target_business) on conflict do nothing;
  select next_number into sequence_value from public.invoice_sequences where business_id=target_business for update;
  update public.invoice_sequences set next_number=sequence_value+1 where business_id=target_business;
  -- lpad truncates over-width values: explicitly preserve all digits once a sequence grows.
  number_text := lpad(sequence_value::text,greatest(settings.invoice_number_digits,length(sequence_value::text)),'0');
  if document_prefix is distinct from settings.invoice_prefix then
    return document_prefix || '-' || lpad(sequence_value::text,greatest(6,length(sequence_value::text)),'0');
  end if;
  formatted := replace(settings.invoice_number_format,'{prefix}',document_prefix);
  formatted := replace(formatted,'{year}',to_char(current_date,'YYYY'));
  formatted := replace(formatted,'{month}',to_char(current_date,'MM'));
  return replace(formatted,'{number}',number_text);
end $$;
revoke all on function public.next_document_number(uuid,text) from public,anon,authenticated;

alter table public.invoices add column brand_snapshot jsonb;
create function public.capture_invoice_brand() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  select jsonb_build_object('name',b.name,'legal_name',b.legal_name,'email',b.email,'phone',b.phone,
    'address',b.address,'tax_number',b.tax_number,'tax_name',b.tax_name,'invoice_design',b.invoice_design)
    into new.brand_snapshot from public.businesses b where b.id=new.business_id;
  return new;
end $$;
revoke all on function public.capture_invoice_brand() from public,anon,authenticated;
create trigger invoice_brand_snapshot before insert on public.invoices for each row execute function public.capture_invoice_brand();
-- Freeze the best available business details for legacy invoices too.
update public.invoices i set brand_snapshot=jsonb_build_object('name',b.name,'legal_name',b.legal_name,'email',b.email,'phone',b.phone,
  'address',b.address,'tax_number',b.tax_number,'tax_name',b.tax_name,'invoice_design',b.invoice_design)
from public.businesses b where b.id=i.business_id and i.brand_snapshot is null;

create function public.create_invoice_with_design(p_business_id uuid,p_client_id uuid,p_due_date date,p_notes text,p_items jsonb,p_template_id text default null)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare invoice_id uuid;
begin
  if auth.uid() is null or not public.has_permission(p_business_id,'invoices.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_template_id is not null and p_template_id not in ('classic','minimal') then raise exception 'invalid template' using errcode='22023'; end if;
  invoice_id := public.create_invoice(p_business_id,p_client_id,p_due_date,p_notes,p_items);
  if p_template_id is not null then update public.invoices set brand_snapshot=jsonb_set(brand_snapshot,'{invoice_design,template}',to_jsonb(p_template_id)) where id=invoice_id; end if;
  return invoice_id;
end $$;
revoke all on function public.create_invoice_with_design(uuid,uuid,date,text,jsonb,text) from public,anon;
grant execute on function public.create_invoice_with_design(uuid,uuid,date,text,jsonb,text) to authenticated;

create function public.refresh_draft_invoice_design(p_invoice_id uuid,p_template_id text) returns void
language plpgsql security definer set search_path=public,auth as $$
declare document public.invoices%rowtype; brand jsonb;
begin
  select * into document from public.invoices where id=p_invoice_id for update;
  if auth.uid() is null or document.id is null or not public.has_permission(document.business_id,'invoices.update') then raise exception 'not authorized' using errcode='42501'; end if;
  if document.status <> 'draft' or p_template_id not in ('classic','minimal') or p_template_id is null then raise exception 'invalid draft design' using errcode='22023'; end if;
  select jsonb_build_object('name',b.name,'legal_name',b.legal_name,'email',b.email,'phone',b.phone,
    'address',b.address,'tax_number',b.tax_number,'tax_name',b.tax_name,'invoice_design',b.invoice_design)
    into brand from public.businesses b where b.id=document.business_id;
  update public.invoices set brand_snapshot=jsonb_set(brand,'{invoice_design,template}',to_jsonb(p_template_id)) where id=document.id;
end $$;
revoke all on function public.refresh_draft_invoice_design(uuid,text) from public,anon;
grant execute on function public.refresh_draft_invoice_design(uuid,text) to authenticated;

-- Unique object names retain old logos for invoice snapshots; no overwrite/delete policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('business-logos','business-logos',false,2097152,array['image/png']) on conflict do nothing;
create policy business_logo_read on storage.objects for select to authenticated using (
  bucket_id='business-logos' and (public.has_permission(public.storage_object_business_id(name),'invoices.read') or public.has_permission(public.storage_object_business_id(name),'settings.manage'))
);
create policy business_logo_upload on storage.objects for insert to authenticated with check (
  bucket_id='business-logos' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$'
  and public.has_permission(public.storage_object_business_id(name),'settings.manage')
);
