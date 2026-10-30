import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/finance";
import { allRows } from "@/lib/queries";

export default async function ReportsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const supabase = await createClient();
  const [{ data: business }, { data: totals }, clients] = await Promise.all([
    supabase.from("businesses").select("currency_code").throwOnError().eq("id",businessId).single().throwOnError(),
    supabase.rpc("financial_summary",{ p_business_id:businessId }).throwOnError(),
    allRows((from,to) => supabase.from("clients").select("id,name").throwOnError().eq("business_id",businessId).order("id").range(from,to)),
  ]);
  if (!business || !totals) throw new Error("Unable to load reports");
  return <section className="workspace"><div className="page-title"><h1>Financial reports</h1><div className="export-links"><Link href={`/api/businesses/${businessId}/export/invoices`}>Export invoices CSV</Link><Link href={`/api/businesses/${businessId}/export/payments`}>Export payments CSV</Link></div></div><div className="stat-grid">{[["Invoiced",totals.invoiced],["Collected",totals.collected],["Outstanding",totals.outstanding],["Overdue",totals.overdue]].map(([label,value]) => <article key={label}><span>{label}</span><strong>{formatMoney(Number(value),business.currency_code)}</strong></article>)}</div><section className="table-card"><h2>Client statements</h2>{clients.map((client) => <p key={client.id}><Link href={`/api/businesses/${businessId}/export/statement?clientId=${client.id}`}>{client.name} — Download statement CSV</Link></p>)}</section></section>;
}
