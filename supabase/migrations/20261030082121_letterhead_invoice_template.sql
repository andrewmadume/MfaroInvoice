-- Extend the existing permission-checked template allowlists. Existing grants are preserved.
create or replace function public.valid_invoice_design(design jsonb, business_id uuid) returns boolean
language plpgsql immutable security invoker set search_path=public as $$
declare entry record;
begin
  if jsonb_typeof(design) is distinct from 'object' then return false; end if;
  for entry in select * from jsonb_each(design) loop
    if entry.key not in ('template','accent','background','bankName','accountName','accountNumber','branchCode','accountType','swiftCode','paymentInstructions','terms','footer','website','logoPath')
      or jsonb_typeof(entry.value) is distinct from 'string' or length(entry.value #>> '{}') > 2000 then return false; end if;
  end loop;
  return coalesce(design->>'template','classic') in ('classic','minimal','letterhead')
    and coalesce(design->>'accent','#1155cc') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(design->>'background','#ffffff') ~ '^#[0-9a-fA-F]{6}$'
    and (coalesce(design->>'logoPath','') = '' or design->>'logoPath' ~ ('^' || business_id::text || '/[0-9a-f-]{36}\.png$'));
end $$;

create or replace function public.create_invoice_with_design(p_business_id uuid,p_client_id uuid,p_due_date date,p_notes text,p_items jsonb,p_template_id text default null)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare invoice_id uuid;
begin
  if auth.uid() is null or not public.has_permission(p_business_id,'invoices.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_template_id is not null and p_template_id not in ('classic','minimal','letterhead') then raise exception 'invalid template' using errcode='22023'; end if;
  invoice_id := public.create_invoice(p_business_id,p_client_id,p_due_date,p_notes,p_items);
  if p_template_id is not null then update public.invoices set brand_snapshot=jsonb_set(brand_snapshot,'{invoice_design,template}',to_jsonb(p_template_id)) where id=invoice_id; end if;
  return invoice_id;
end $$;

create or replace function public.refresh_draft_invoice_design(p_invoice_id uuid,p_template_id text) returns void
language plpgsql security definer set search_path=public,auth as $$
declare document public.invoices%rowtype; brand jsonb;
begin
  select * into document from public.invoices where id=p_invoice_id for update;
  if auth.uid() is null or document.id is null or not public.has_permission(document.business_id,'invoices.update') then raise exception 'not authorized' using errcode='42501'; end if;
  if document.status <> 'draft' or p_template_id not in ('classic','minimal','letterhead') or p_template_id is null then raise exception 'invalid draft design' using errcode='22023'; end if;
  select jsonb_build_object('name',b.name,'legal_name',b.legal_name,'email',b.email,'phone',b.phone,
    'address',b.address,'tax_number',b.tax_number,'tax_name',b.tax_name,'invoice_design',b.invoice_design)
    into brand from public.businesses b where b.id=document.business_id;
  update public.invoices set brand_snapshot=jsonb_set(brand,'{invoice_design,template}',to_jsonb(p_template_id)) where id=document.id;
end $$;
