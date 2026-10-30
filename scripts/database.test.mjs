import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL execution with small stand-ins for Supabase's managed schemas.
// Live Auth/Storage, provider HTTP and deployment configuration are separate checks.
test("migration chain and financial/security regression scenarios", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
      alter table storage.objects enable row level security;
      grant select,insert on storage.objects to authenticated;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant select on auth.users to authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);
    for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).sort()) {
      // These hosted extensions are verified on Supabase; PGlite supplies core crypto.
      const sql = (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).replace(/create extension if not exists (pgcrypto|pg_cron|pg_net)( with schema extensions)?;/g, "");
      try { await db.exec(sql); } catch (error) { throw new Error(`${file}: ${error.message}`, { cause:error }); }
    }
    await db.exec("grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to service_role;");
    const alpha = "11111111-1111-4111-8111-111111111111", beta = "22222222-2222-4222-8222-222222222222";
    await db.query("insert into auth.users values ($1),($2)", [alpha,beta]);
    async function session(user, role="authenticated", aal="aal1") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claim.aal',$3,false)",[user??"",role,aal]);
      await db.exec(`set role ${role}`);
    }
    async function scalar(sql,params=[]) { const result=await db.query(sql,params);return Object.values(result.rows[0])[0]; }
    async function denied(sql,params=[]) { await assert.rejects(db.query(sql,params), /permission|authorized|violates|mismatch|not pending|MFA|invalid|reference conflict/i); }
    await session(alpha);
    const businessA=await scalar("select public.create_business('Alpha Company','alpha','USD')");
    const clientA=await scalar("insert into public.clients(business_id,name,email) values($1,'A Client','a@example.com') returning id",[businessA]);
    await session(beta);
    const businessB=await scalar("select public.create_business('Beta Company','beta','ZAR')");
    const clientB=await scalar("insert into public.clients(business_id,name) values($1,'B Client') returning id",[businessB]);
    await session(alpha);
    const items=JSON.stringify([{description:"Fractional tax",quantity:1,unitPrice:0.1,taxRate:15,discountAmount:0}]);
    const invoice=await scalar("select public.create_invoice($1,$2,current_date-1,'Notes',$3::jsonb)",[businessA,clientA,items]);
    assert.equal(Number(await scalar("select total from public.invoices where id=$1",[invoice])),0.12);
    assert.equal(await scalar("select notes from public.invoices where id=$1",[invoice]),"Notes");
    await scalar("select public.send_invoice($1)",[invoice]);
    await db.query("insert into public.payment_provider_configs(business_id,provider,enabled) values($1,'paystack',true)",[businessA]);
    const intent=await scalar("select (public.create_payment_intent($1,'paystack','test_reference')).id",[invoice]);
    await session(beta);
    assert.equal(Number(await scalar("select count(*) from public.payment_intents where id=$1",[intent])),0);
    await denied("update public.payment_intents set status='paid' where id=$1",[intent]);
    await denied("select public.finalize_provider_payment('paystack','test_reference',0.12,'USD',null)");
    await session(alpha);
    await denied("update public.businesses set mfa_required=true where id=$1",[businessA]);
    await denied("update public.business_users set role='staff' where business_id=$1",[businessA]);
    await denied("insert into public.business_user_permissions(business_id,user_id,permission_code,granted) values($1,$2,'users.manage',false)",[businessA,alpha]);
    await denied("select public.set_business_mfa_requirement($1,true)",[businessA]);
    await session(alpha,"authenticated","aal2");
    await scalar("select public.set_business_mfa_requirement($1,true)",[businessA]);
    await db.query("update public.businesses set name='Alpha Updated' where id=$1",[businessA]);
    const product=await scalar("insert into public.products(business_id,name,unit_price) values($1,'Product',1) returning id",[businessA]);
    await denied("update public.products set stock_on_hand=90 where id=$1",[product]);
    await denied("insert into public.products(business_id,name,unit_price,stock_on_hand) values($1,'Bypass',1,50)",[businessA]);
    await scalar("select public.adjust_inventory($1,$2,5,'purchase','test')",[businessA,product]);
    assert.equal(Number(await scalar("select stock_on_hand from public.products where id=$1",[product])),5);
    await denied("insert into public.projects(business_id,client_id,name) values($1,$2,'Foreign client')",[businessA,clientB]);
    const quote=await scalar("select public.create_quote($1,$2,null,'Quote notes',$3::jsonb)",[businessA,clientA,items]);
    assert.ok(await scalar("select public.convert_quote_to_invoice($1,null)",[quote]));
    const recurring=await scalar("select public.create_recurring_invoice($1,$2,'monthly',current_date,14,null,$3::jsonb)",[businessA,clientA,items]);
    await session(null,"service_role");
    const generated=await scalar("select public.run_recurring_invoice($1)",[recurring]);
    assert.ok(generated);
    assert.equal(await scalar("select actor_type from public.invoice_status_history where invoice_id=$1",[generated]),"system");
    assert.equal(await scalar("select public.run_recurring_invoice($1)",[recurring]),null);
    await denied("select public.finalize_provider_payment('paystack','test_reference',0.13,'USD',null)");
    assert.equal(Number(await scalar("select amount_paid from public.invoices where id=$1",[invoice])),0);
    const payment=await scalar("select public.finalize_provider_payment('paystack','test_reference',0.12,'USD',null)");
    assert.ok(payment);
    assert.equal(await scalar("select public.finalize_provider_payment('paystack','test_reference',0.12,'USD',null)"),payment);
    await denied("select public.finalize_provider_payment('paystack','test_reference',0.13,'USD',null)");
    assert.equal(Number(await scalar("select count(*) from public.payments where invoice_id=$1",[invoice])),1);
    assert.equal(await scalar("select status from public.payment_intents where id=$1",[intent]),"paid");
    assert.equal(await scalar("select status from public.invoice_reminders where invoice_id=$1",[invoice]),"cancelled");
    await session(alpha);
    // Drafts are excluded; database aggregates include all eligible rows.
    let summary=await scalar("select public.financial_summary($1)",[businessA]);
    assert.equal(Number(summary.invoiced),0.12); assert.equal(Number(summary.outstanding),0);
    const unpaid=await scalar("select public.create_invoice($1,$2,current_date-1,null,$3::jsonb)",[businessA,clientA,items]);
    await scalar("select public.send_invoice($1)",[unpaid]);
    await session(null,"service_role");
    const claims=await db.query("select * from public.claim_invoice_reminders()");
    assert.equal(claims.rows.length,1);
    assert.equal((await db.query("select * from public.claim_invoice_reminders()")).rows.length,0);
    await scalar("select public.record_payment($1,0.12,null,'manual')",[unpaid]);
    assert.equal(await scalar("select status from public.invoice_reminders where invoice_id=$1",[unpaid]),"cancelled");
    await db.query("insert into public.invoices(business_id,client_id,invoice_number,currency_code,total,status) select $1,$2,'BULK-'||n,'USD',1,'sent' from generate_series(1,1003) n",[businessA,clientA]);
    await session(alpha);
    summary=await scalar("select public.financial_summary($1)",[businessA]);
    assert.equal(Number(summary.invoiced),1003.24);
    assert.equal(Number(summary.outstanding),1003);
    assert.equal(Number(summary.topClients[0].invoiced),1003.24);
    // Branding snapshots, format changes and tenant boundaries use the real SQL functions.
    await db.query("update public.businesses set invoice_prefix='MF',invoice_number_format='{prefix}/{year}/{month}/{number}',invoice_number_digits=3,invoice_design=$2::jsonb where id=$1",[businessA,JSON.stringify({template:'classic',accent:'#1155cc',background:'#ffffff',bankName:'Example Bank'})]);
    const branded=await scalar("select public.create_invoice_with_design($1,$2,null,null,$3::jsonb,'minimal')",[businessA,clientA,items]);
    assert.match(await scalar("select invoice_number from public.invoices where id=$1",[branded]),/^MF\/\d{4}\/\d{2}\/\d{3,}$/);
    assert.equal(await scalar("select brand_snapshot #>> '{invoice_design,template}' from public.invoices where id=$1",[branded]),'minimal');
    await db.query("update public.businesses set name='New brand',invoice_design=jsonb_set(invoice_design,'{bankName}',to_jsonb('New Bank'::text)) where id=$1",[businessA]);
    assert.equal(await scalar("select brand_snapshot->>'name' from public.invoices where id=$1",[branded]),'Alpha Updated');
    assert.equal(await scalar("select brand_snapshot #>> '{invoice_design,bankName}' from public.invoices where id=$1",[branded]),'Example Bank');
    await scalar("select public.refresh_draft_invoice_design($1,'classic')",[branded]);
    assert.equal(await scalar("select brand_snapshot->>'name' from public.invoices where id=$1",[branded]),'New brand');
    assert.equal((await db.query("update public.invoices set brand_snapshot='{}' where id=$1 returning 1",[branded])).rows.length,0);
    await denied("update public.businesses set invoice_number_format='{number}{number}' where id=$1",[businessA]);
    await denied("update public.businesses set invoice_design=$2::jsonb where id=$1",[businessA,JSON.stringify({logoPath:businessB+'/33333333-3333-4333-8333-333333333333.png'})]);
    await scalar("select public.send_invoice($1)",[branded]);
    await denied("select public.refresh_draft_invoice_design($1,'minimal')",[branded]);
    await session(beta);
    await denied("select public.refresh_draft_invoice_design($1,'classic')",[branded]);
    await denied("select public.create_invoice_with_design($1,$2,null,null,$3::jsonb,'classic')",[businessA,clientA,items]);
    assert.equal((await db.query("update public.businesses set invoice_design='{}' where id=$1 returning 1",[businessA])).rows.length,0);
    assert.equal(Number(await scalar("select count(*) from public.invoices where id=$1",[branded])),0);
    await session(null,'service_role');
    await db.query("update public.invoice_sequences set next_number=1000001 where business_id=$1",[businessA]);
    await session(alpha,'authenticated','aal2');
    const large=await scalar("select public.create_invoice($1,$2,null,null,$3::jsonb)",[businessA,clientA,items]);
    assert.ok((await scalar("select invoice_number from public.invoices where id=$1",[large])).endsWith('/1000001'));
    await db.query("update public.businesses set invoice_design=jsonb_set(invoice_design,'{template}',to_jsonb('letterhead'::text)) where id=$1",[businessA]);
    const letterhead=await scalar("select public.create_invoice_with_design($1,$2,null,null,$3::jsonb,'letterhead')",[businessA,clientA,items]);
    assert.equal(await scalar("select brand_snapshot #>> '{invoice_design,template}' from public.invoices where id=$1",[letterhead]),'letterhead');
    await scalar("select public.refresh_draft_invoice_design($1,'letterhead')",[letterhead]);
    await denied("select public.refresh_draft_invoice_design($1,'unsupported')",[letterhead]);
    const logoPath=businessA+'/33333333-3333-4333-8333-333333333333.png';
    await db.query("insert into storage.objects(bucket_id,name) values('business-logos',$1)",[logoPath]);
    assert.equal(Number(await scalar("select count(*) from storage.objects where name=$1",[logoPath])),1);
    await denied("insert into storage.objects(bucket_id,name) values('business-logos',$1)",[businessB+'/33333333-3333-4333-8333-333333333333.png']);
    await session(beta);
    assert.equal(Number(await scalar("select count(*) from storage.objects where name=$1",[logoPath])),0);
    await db.exec("reset role");
    assert.equal(Number(await scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')")),0);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.next_document_number(uuid,text)','EXECUTE')"),false);
    await db.exec(await readFile(new URL("../supabase/tests/tenant_isolation.sql",import.meta.url),"utf8"));
  } finally { await db.close(); }
});
