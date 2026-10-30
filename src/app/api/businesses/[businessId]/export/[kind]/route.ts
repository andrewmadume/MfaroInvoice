import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/queries";
import { csvCell, financialStatuses } from "@/lib/finance";
export const dynamic = "force-dynamic";
const routeSchema = z.object({businessId:z.string().uuid(),kind:z.enum(["invoices","payments","statement"])});
const csv = (headers: string[], rows: unknown[][]) => [headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n");
export async function GET(request: NextRequest, {params}: {params:Promise<{businessId:string;kind:string}>}) {
  const parsed=routeSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({error:"Not found"},{status:404});
  const {businessId,kind}=parsed.data; const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  let content:string;
  try {
    if(kind==="payments") {
      const rows=await allRows((from,to)=>supabase.from("payments").select("id,invoice_id,amount,currency_code,paid_at,provider_reference").eq("business_id",businessId).order("id").range(from,to));
      content=csv(["Payment ID","Invoice ID","Amount","Currency","Paid at","Reference"],rows.map(r=>[r.id,r.invoice_id,Number(r.amount),r.currency_code,r.paid_at,r.provider_reference]));
    } else {
      const clientId=request.nextUrl.searchParams.get("clientId");
      if(kind==="statement" && !z.string().uuid().safeParse(clientId).success) return NextResponse.json({error:"Client required"},{status:400});
      const rows=await allRows((from,to)=> {
        let query=supabase.from("invoices").select("id,invoice_number,issue_date,due_date,status,total,amount_paid,currency_code,client:clients(name)").eq("business_id",businessId).order("id").range(from,to);
        if(kind==="statement") query=query.eq("client_id",clientId!).in("status",financialStatuses);
        return query;
      });
      content=csv(["Invoice","Client","Issue date","Due date","Status","Currency","Total","Amount paid","Balance"],rows.map(r=> {
        const client=r.client as unknown as {name?:string}|{name?:string}[]|null;
        return [r.invoice_number,Array.isArray(client)?client[0]?.name:client?.name,r.issue_date,r.due_date,r.status,r.currency_code,Number(r.total),Number(r.amount_paid),Number(r.total)-Number(r.amount_paid)];
      }));
    }
  } catch { return NextResponse.json({error:"Export unavailable"},{status:500}); }
  return new NextResponse(content,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="${kind}.csv"`,"cache-control":"no-store"}});
}
