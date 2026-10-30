import { allRows } from "@/lib/queries";
import { formatMoney } from "@/lib/finance";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type ClientRelation = { name?: string } | { name?: string }[] | null;
function clientName(client: unknown) { const value = client as ClientRelation; return Array.isArray(value) ? value[0]?.name : value?.name; }

export default async function BusinessDashboard({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params; const supabase = await createClient(); const { data: business, error: businessError } = await supabase.from("businesses").select("currency_code,tax_name,default_tax_rate").throwOnError().eq("id", businessId).single(); if (businessError || !business) throw new Error("Unable to load business settings");
  const [invoices, clients, outstanding] = await Promise.all([
    supabase.from("invoices").select("id,invoice_number,status,total,amount_paid,client:clients(name)").throwOnError().eq("business_id", businessId).order("created_at", { ascending: false }).limit(6),
    supabase.from("clients").select("id", { count: "exact", head: true }).throwOnError().eq("business_id", businessId),
    allRows((from,to) => supabase.from("invoices").select("total,amount_paid").eq("business_id", businessId).in("status", ["sent", "viewed", "partial", "overdue"]).order("id").range(from,to)),
  ]);
  const balance = outstanding.reduce((sum, invoice) => sum + Number(invoice.total) - Number(invoice.amount_paid), 0);
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">BUSINESS OVERVIEW</p><h1>Know what’s next.</h1></div><Link className="button" href={`/app/${businessId}/invoices/new`}>Create invoice</Link></div><div className="stat-grid"><article><span>Outstanding</span><strong>{formatMoney(balance, business.currency_code)}</strong></article><article><span>Clients</span><strong>{clients.count ?? 0}</strong></article><article><span>Recent invoices</span><strong>{invoices.data?.length ?? 0}</strong></article></div><section className="table-card"><div className="card-title"><h2>Recent invoices</h2><Link href={`/app/${businessId}/invoices`}>View all</Link></div>{invoices.data?.length ? <table><thead><tr><th>Number</th><th>Client</th><th>Status</th><th className="align-right">Total</th></tr></thead><tbody>{invoices.data.map((invoice) => <tr key={invoice.id}><td><Link href={`/app/${businessId}/invoices/${invoice.id}`}>{invoice.invoice_number}</Link></td><td>{clientName(invoice.client)}</td><td><span className={`badge ${invoice.status}`}>{invoice.status}</span></td><td className="align-right">{formatMoney(Number(invoice.total), business.currency_code)}</td></tr>)}</tbody></table> : <p className="empty-state">Your invoice activity will appear here.</p>}</section></section>;
}
