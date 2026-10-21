import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function PayInvoice({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params; const admin = createAdminClient();
  const { data: intent } = await admin.from("payment_intents").select("id,provider,expected_amount,currency_code,status,invoice:invoices(invoice_number,client:clients(name)),business:businesses(name)").throwOnError().eq("id", intentId).maybeSingle();
  if (!intent || intent.status === "paid" || intent.status === "cancelled") notFound();
  const invoice = Array.isArray(intent.invoice) ? intent.invoice[0] : intent.invoice; const business = Array.isArray(intent.business) ? intent.business[0] : intent.business; const client = invoice && (Array.isArray(invoice.client) ? invoice.client[0] : invoice.client);
  return <main className="auth"><section><p className="eyebrow">SECURE PAYMENT</p><h1>{business?.name ?? "MfaroInvoice"}</h1><p>Invoice <strong>{invoice?.invoice_number}</strong> for {client?.name ?? "customer"}</p><p className="estimate"><strong>{intent.currency_code} {Number(intent.expected_amount).toFixed(2)}</strong></p><form action={`/api/pay/${intent.id}/checkout`} method="post"><button className="button" type="submit">Pay with {intent.provider === "paystack" ? "Paystack" : "Flutterwave"}</button></form><p className="notice">Your payment is processed by the selected provider. MfaroInvoice never receives card or account credentials.</p></section></main>;
}
