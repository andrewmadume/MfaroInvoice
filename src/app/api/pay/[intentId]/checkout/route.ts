import { currencyDecimals } from "@/lib/finance";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function amountInSubunit(amount: number, currency: string) { return Math.round(amount * 10 ** currencyDecimals(currency)).toString(); }

export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params; const admin = createAdminClient();
  const { data: intent } = await admin.from("payment_intents").select("id,provider,provider_reference,expected_amount,currency_code,status,invoice:invoices(invoice_number,client:clients(name,email))").eq("id", intentId).maybeSingle();
  if (!intent || intent.status !== "pending") return NextResponse.json({ error: "payment-unavailable" }, { status: 404 });
  const invoice = Array.isArray(intent.invoice) ? intent.invoice[0] : intent.invoice; const client = invoice && (Array.isArray(invoice.client) ? invoice.client[0] : invoice.client);
  if (!client?.email) return NextResponse.json({ error: "client-email-required" }, { status: 400 });
  const callbackUrl = new URL(`/pay/${intent.id}`, process.env.NEXT_PUBLIC_SITE_URL ?? request.url).toString(); let authorizationUrl: string | undefined;
  if (intent.provider === "paystack") {
    const secret = process.env.PAYSTACK_SECRET_KEY; if (!secret) return NextResponse.json({ error: "paystack-not-configured" }, { status: 503 });
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: client.email, amount: amountInSubunit(Number(intent.expected_amount), intent.currency_code), currency: intent.currency_code, reference: intent.provider_reference, callback_url: callbackUrl, metadata: { payment_intent_id: intent.id, invoice_number: invoice?.invoice_number } }) });
    const payload = await response.json() as { status?: boolean; data?: { authorization_url?: string } }; authorizationUrl = payload.data?.authorization_url;
  } else {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY; if (!secret) return NextResponse.json({ error: "flutterwave-not-configured" }, { status: 503 });
    const response = await fetch("https://api.flutterwave.com/v3/payments", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ tx_ref: intent.provider_reference, amount: String(intent.expected_amount), currency: intent.currency_code, redirect_url: callbackUrl, customer: { email: client.email, name: client.name ?? "Customer" }, meta: { payment_intent_id: intent.id, invoice_number: invoice?.invoice_number } }) });
    const payload = await response.json() as { status?: string; data?: { link?: string } }; authorizationUrl = payload.data?.link;
  }
  if (!authorizationUrl) return NextResponse.json({ error: "provider-initialization-failed" }, { status: 502 });
  await admin.from("payment_intents").update({ provider_payload: { checkout_initialized_at: new Date().toISOString() } }).eq("id", intent.id);
  return NextResponse.redirect(authorizationUrl, { status: 303 });
}
