import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeScheduler } from "../_shared/scheduler.ts";
Deno.serve(async (request) => {
  const rejection=authorizeScheduler(request); if(rejection) return rejection;
  const key=Deno.env.get("RESEND_API_KEY"), from=Deno.env.get("REMINDER_FROM");
  if(!key || !from) return new Response("Email not configured",{status:503});
  try {
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:reminders}=await db.rpc("claim_invoice_reminders").throwOnError();
    let sent=0;
    for(const reminder of reminders ?? []) {
      const {data:invoice}=await db.from("invoices").select("invoice_number,total,amount_paid,status,currency_code,client:clients(name,email)").eq("id",reminder.invoice_id).single().throwOnError();
      const client=Array.isArray(invoice.client)?invoice.client[0]:invoice.client;
      let status="cancelled";
      if(["sent","viewed","partial","overdue"].includes(invoice.status) && Number(invoice.total)>Number(invoice.amount_paid)) {
        if(!client?.email) status="failed";
        else {
          try {
            const response=await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Idempotency-Key":`invoice-reminder-${reminder.id}`},body:JSON.stringify({from,to:[client.email],subject:`Payment reminder: ${invoice.invoice_number}`,text:`Hello ${client.name}, invoice ${invoice.invoice_number} has an outstanding balance of ${invoice.currency_code} ${Number(invoice.total)-Number(invoice.amount_paid)}.`})});
            status=response.ok?"sent":response.status===429 || response.status>=500?"pending":"failed";
          } catch { status="pending"; }
        }
      }
      await db.from("invoice_reminders").update({status,sent_at:status==="sent"?new Date().toISOString():null,claimed_until:null,claim_token:null,scheduled_for:new Date(Date.now()+15*60*1000).toISOString()}).eq("id",reminder.id).eq("claim_token",reminder.claim_token).eq("status","pending").throwOnError();
      if(status==="sent") sent++;
    }
    return Response.json({sent});
  } catch { return Response.json({error:"Reminder dispatch failed"},{status:500}); }
});
