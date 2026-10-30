import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const providers = new Set(["paystack", "flutterwave"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ businessId: string; invoiceId: string }> }) {
  const { businessId, invoiceId } = await params; const provider = String((await request.formData()).get("provider") ?? "paystack");
  if (!providers.has(provider)) return NextResponse.json({ error: "unsupported-provider" }, { status: 400 });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { data: invoice } = await supabase.from("invoices").select("id").eq("business_id",businessId).eq("id",invoiceId).maybeSingle();
  if (!invoice) return NextResponse.json({error:"not-found"},{status:404});
  const { data: config } = await supabase.from("payment_provider_configs").select("enabled").eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (!config?.enabled) return NextResponse.redirect(new URL(`/app/${businessId}/payments?error=provider-disabled`, request.url), 303);
  const reference = `mfi_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data: intent, error } = await supabase.rpc("create_payment_intent", { p_invoice_id: invoiceId, p_provider: provider, p_reference: reference });
  if (error || !intent) return NextResponse.redirect(new URL(`/app/${businessId}/invoices/${invoiceId}?error=payment-link`, request.url), 303);
  return NextResponse.redirect(new URL(`/pay/${intent.id}`, request.url), 303);
}
