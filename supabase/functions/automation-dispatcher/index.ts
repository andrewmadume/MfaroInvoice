import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeScheduler } from "../_shared/scheduler.ts";
Deno.serve(async (request) => {
  const rejection=authorizeScheduler(request); if(rejection) return rejection;
  try {
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today=new Date().toISOString().slice(0,10);
    const {data:recurring}=await db.from("recurring_invoices").select("id").eq("active",true).lte("next_run_date",today).order("next_run_date").limit(100).throwOnError();
    let invoicesCreated=0;
    for(const item of recurring ?? []) { const {data}=await db.rpc("run_recurring_invoice",{p_recurring_id:item.id}).throwOnError(); if(data) invoicesCreated++; }
    await db.from("invoices").update({status:"overdue"}).lt("due_date",today).in("status",["sent","viewed","partial"]).throwOnError();
    return Response.json({invoicesCreated});
  } catch { return Response.json({error:"Automation failed"},{status:500}); }
});
