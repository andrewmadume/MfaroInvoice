import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
type ClientRelation = { name?: string } | { name?: string }[] | null;
function clientName(client: unknown) { const value = client as ClientRelation; return Array.isArray(value) ? value[0]?.name : value?.name; }

export default async function InvoicesPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params; const supabase = await createClient(); const { data: invoices } = await supabase.from("invoices").select("id,invoice_number,status,issue_date,due_date,total,amount_paid,client:clients(name)").eq("business_id", businessId).order("created_at", { ascending: false });
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">INVOICING</p><h1>Invoices</h1></div><Link className="button" href={`/app/${businessId}/invoices/new`}>New invoice</Link></div><section className="table-card">{invoices?.length ? <table><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th>Status</th><th className="align-right">Balance</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><Link href={`/app/${businessId}/invoices/${invoice.id}`}>{invoice.invoice_number}</Link></td><td>{clientName(invoice.client)}</td><td>{invoice.due_date ?? "—"}</td><td><span className={`badge ${invoice.status}`}>{invoice.status}</span></td><td className="align-right">R {(Number(invoice.total) - Number(invoice.amount_paid)).toFixed(2)}</td></tr>)}</tbody></table> : <p className="empty-state">Create your first invoice to get started.</p>}</section></section>;
}
