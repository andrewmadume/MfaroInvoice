import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, { params }: { params: Promise<{ businessId: string; expenseId: string }> }) {
  const parsed = z.object({ businessId:z.string().uuid(), expenseId:z.string().uuid() }).safeParse(await params);
  if (!parsed.success) return new NextResponse(null,{status:404});
  const supabase = await createClient();
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null,{status:401});
  const { data:expense,error } = await supabase.from("expenses").select("storage_path,original_filename").eq("id",parsed.data.expenseId).eq("business_id",parsed.data.businessId).maybeSingle();
  if (error || !expense) return new NextResponse(null,{status:404});
  const { data:signed,error:signError } = await supabase.storage.from("expense-invoices").createSignedUrl(expense.storage_path,60,{download:expense.original_filename});
  if (signError || !signed?.signedUrl) return new NextResponse(null,{status:404});
  return NextResponse.redirect(signed.signedUrl,{headers:{"cache-control":"private, no-store"}});
}
