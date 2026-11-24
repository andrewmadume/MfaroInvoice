-- Local IDs are not invoice numbers. Number allocation remains transactional on the server.
alter table public.clients add column offline_revision bigint not null default 1;
alter table public.products add column offline_revision bigint not null default 1;
alter table public.invoices add column offline_revision bigint not null default 1;
create function public.bump_offline_revision() returns trigger language plpgsql security invoker set search_path=public as $$
begin new.offline_revision := old.offline_revision + 1; return new; end $$;
revoke all on function public.bump_offline_revision() from public,anon,authenticated;
create trigger clients_offline_revision before update on public.clients for each row execute function public.bump_offline_revision();
create trigger products_offline_revision before update on public.products for each row execute function public.bump_offline_revision();
create trigger invoices_offline_revision before update on public.invoices for each row execute function public.bump_offline_revision();

create table public.offline_receipts (
  account_id uuid not null references auth.users(id), business_id uuid not null references public.businesses(id),
  operation_id uuid not null, request jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(account_id,business_id,operation_id)
);
alter table public.offline_receipts enable row level security;
-- No direct Data API access. Receipts are only read/written by the permission-checked RPC.
revoke all on public.offline_receipts from public,anon,authenticated;
grant all on public.offline_receipts to service_role;
create index offline_origins_idx on public.offline_receipts(business_id,(request->>'kind'),(request->>'id')) where request->>'version'='0' and result->>'outcome'='ok';

create function public.apply_offline_change(p_business_id uuid,p_operation_id uuid,p_kind text,p_record_id uuid,p_version bigint,p_deleted boolean,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
<<offline_change>>
declare who uuid := auth.uid(); request_value jsonb; previous public.offline_receipts%rowtype; row_value jsonb; result_value jsonb;
declare invoice_row public.invoices%rowtype; invoice_id uuid; item jsonb; q numeric(19,4); price numeric(19,4); disc numeric(19,4); rate numeric(7,4); base numeric(19,4); tax numeric(19,4);
declare subtotal numeric(19,4):=0; discount_total numeric(19,4):=0; tax_total numeric(19,4):=0; currency_value text; required_permission text;
begin
  if who is null or p_kind not in ('clients','products','invoices') or p_version is null or p_version<0 or p_deleted is null or p_operation_id is null or p_record_id is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>200000 then raise exception 'invalid offline change' using errcode='22023'; end if;
  required_permission := p_kind||case when p_deleted then '.delete' when p_version=0 then '.create' else '.update' end;
  if not public.has_permission(p_business_id,required_permission) or not public.has_permission(p_business_id,p_kind||'.read') then raise exception 'not authorized' using errcode='42501'; end if;
  request_value:=jsonb_build_object('kind',p_kind,'id',p_record_id,'version',p_version,'deleted',p_deleted,'data',p_data);
  -- Serialise repeated operation IDs, including interrupted requests from different windows.
  perform pg_advisory_xact_lock(hashtextextended(who::text||p_business_id::text||p_operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||p_kind||p_record_id::text,1));
  select * into previous from public.offline_receipts where account_id=who and business_id=p_business_id and operation_id=p_operation_id;
  if found then
    if previous.request<>request_value then raise exception 'operation reference conflict' using errcode='22023'; end if;
    return previous.result;
  end if;
  if p_kind='clients' then select to_jsonb(c) into row_value from public.clients c where id=p_record_id and business_id=p_business_id for update;
  elsif p_kind='products' then select to_jsonb(c) into row_value from public.products c where id=p_record_id and business_id=p_business_id for update;
  else select to_jsonb(c) into row_value from public.invoices c where id=p_record_id and business_id=p_business_id for update; end if;
  -- Deleted rows and issued invoices cannot be resurrected or overwritten by stale devices.
  if (p_version=0 and (row_value is not null or exists(select 1 from public.offline_receipts where business_id=p_business_id and request->>'kind'=p_kind and request->>'id'=p_record_id::text and request->>'version'='0' and result->>'outcome'='ok'))) or (p_version>0 and (row_value is null or (row_value->>'offline_revision')::bigint<>p_version)) or (p_kind='invoices' and row_value is not null and row_value->>'status'<>'draft') then
    if p_kind='invoices' and row_value is not null then row_value:=row_value||jsonb_build_object('template',row_value#>>'{brand_snapshot,invoice_design,template}','items',(select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unitPrice',unit_price,'discountAmount',discount_amount,'taxRate',tax_rate) order by id) from public.invoice_items where invoice_items.invoice_id=p_record_id)); end if;
    result_value:=jsonb_build_object('outcome','conflict','record',row_value,'version',coalesce((row_value->>'offline_revision')::bigint,0));
    insert into public.offline_receipts values(who,p_business_id,p_operation_id,request_value,result_value,now()); return result_value;
  end if;
  if p_deleted then
    if p_kind='clients' then delete from public.clients where id=p_record_id and business_id=p_business_id;
    elsif p_kind='products' then delete from public.products where id=p_record_id and business_id=p_business_id;
    else delete from public.invoice_items where invoice_items.invoice_id=p_record_id and business_id=p_business_id; delete from public.invoices where id=p_record_id and business_id=p_business_id; end if;
    row_value:=null;
  elsif p_kind in ('clients','products') then
    if nullif(trim(p_data->>'name'),'') is null or length(p_data->>'name')>160 then raise exception 'invalid name' using errcode='22023'; end if;
    if p_kind='clients' then
      if length(coalesce(p_data->>'email',''))>254 or length(coalesce(p_data->>'phone',''))>60 then raise exception 'invalid customer' using errcode='22023'; end if;
      if p_version=0 then insert into public.clients(id,business_id,name,email,phone) values(p_record_id,p_business_id,trim(p_data->>'name'),nullif(p_data->>'email',''),nullif(p_data->>'phone','')) returning to_jsonb(clients.*) into row_value;
      else update public.clients set name=trim(p_data->>'name'),email=nullif(p_data->>'email',''),phone=nullif(p_data->>'phone','') where id=p_record_id and business_id=p_business_id returning to_jsonb(clients.*) into row_value; end if;
    else
      price:=(p_data->>'unit_price')::numeric(19,4); rate:=(p_data->>'tax_rate')::numeric(7,4);
      if price is null or rate is null or price<0 or price>1e9 or rate<0 or rate>100 then raise exception 'invalid product' using errcode='22023'; end if;
      if p_version=0 then insert into public.products(id,business_id,name,unit_price,tax_rate) values(p_record_id,p_business_id,trim(p_data->>'name'),price,rate) returning to_jsonb(products.*) into row_value;
      else update public.products set name=trim(p_data->>'name'),unit_price=price,tax_rate=rate where id=p_record_id and business_id=p_business_id returning to_jsonb(products.*) into row_value; end if;
    end if;
  else
    if coalesce(p_data->>'template','classic') not in ('classic','minimal','letterhead') or length(coalesce(p_data->>'notes',''))>2000 then raise exception 'invalid invoice' using errcode='22023'; end if;
    invoice_id:=p_record_id;
    if p_version=0 then
      -- Preserve the stable draft UUID across windows, backups and different operation IDs.
      insert into public.invoices(id,business_id,client_id,invoice_number,currency_code)
      select p_record_id,p_business_id,(p_data->>'client_id')::uuid,public.next_document_number(p_business_id,invoice_prefix),currency_code from public.businesses where id=p_business_id;
    end if;
      if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'invalid invoice items' using errcode='22023'; end if;
      if not exists(select 1 from public.clients where id=(p_data->>'client_id')::uuid and business_id=p_business_id) then raise exception 'client tenant mismatch' using errcode='42501'; end if;
      select currency_code into currency_value from public.invoices where id=invoice_id;
      delete from public.invoice_items where invoice_items.invoice_id=offline_change.invoice_id;
      for item in select value from jsonb_array_elements(p_data->'items') loop
        q:=(item->>'quantity')::numeric(19,4); price:=(item->>'unitPrice')::numeric(19,4); disc:=(item->>'discountAmount')::numeric(19,4); rate:=(item->>'taxRate')::numeric(7,4);
        if q is null or price is null or disc is null or rate is null or q<=0 or q>1e6 or price<0 or price>1e9 or disc<0 or rate<0 or rate>100 or nullif(trim(item->>'description'),'') is null or length(item->>'description')>500 then raise exception 'invalid invoice item' using errcode='22023'; end if;
        base:=round(q*price,4); if disc>base then raise exception 'discount exceeds line subtotal' using errcode='22023'; end if;
        tax:=round((base-disc)*rate/100,4);
        insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price,discount_amount,tax_rate,line_total) values(p_business_id,invoice_id,trim(item->>'description'),q,price,disc,rate,base-disc+tax);
        subtotal:=subtotal+base; discount_total:=discount_total+disc; tax_total:=tax_total+tax;
      end loop;
      update public.invoices set client_id=(p_data->>'client_id')::uuid,due_date=nullif(p_data->>'due_date','')::date,notes=p_data->>'notes',subtotal=offline_change.subtotal,discount_total=offline_change.discount_total,tax_total=offline_change.tax_total,total=round(offline_change.subtotal-offline_change.discount_total+offline_change.tax_total,public.currency_decimals(currency_value)),brand_snapshot=jsonb_set(brand_snapshot,'{invoice_design,template}',to_jsonb(coalesce(p_data->>'template','classic'))) where id=invoice_id;
    if p_version=0 then
      insert into public.invoice_status_history(business_id,invoice_id,status,changed_by) values(p_business_id,invoice_id,'draft',who);
      insert into public.activity_logs(business_id,actor_id,action,entity_type,entity_id) values(p_business_id,who,'invoice.created','invoice',invoice_id);
    end if;
    select to_jsonb(i)||jsonb_build_object('template',i.brand_snapshot#>>'{invoice_design,template}','items',(select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unitPrice',unit_price,'discountAmount',discount_amount,'taxRate',tax_rate) order by id) from public.invoice_items where invoice_items.invoice_id=i.id)) into row_value from public.invoices i where i.id=invoice_id;
  end if;
  result_value:=jsonb_build_object('outcome','ok','record',row_value,'version',coalesce((row_value->>'offline_revision')::bigint,0));
  insert into public.offline_receipts values(who,p_business_id,p_operation_id,request_value,result_value,now());
  return result_value;
end $$;
revoke all on function public.apply_offline_change(uuid,uuid,text,uuid,bigint,boolean,jsonb) from public,anon;
grant execute on function public.apply_offline_change(uuid,uuid,text,uuid,bigint,boolean,jsonb) to authenticated;

