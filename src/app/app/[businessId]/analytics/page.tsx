import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/finance";
type TopClient = { id: string; name: string; invoiced: number; collected: number };

export default async function AnalyticsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params; const supabase = await createClient();
  const [{data:business},{data:totals}] = await Promise.all([
    supabase.from("businesses").select("currency_code").throwOnError().eq("id",businessId).single().throwOnError(),
    supabase.rpc("financial_summary",{p_business_id:businessId}).throwOnError(),
  ]);
  if (!business || !totals) throw new Error("Unable to load analytics");
  const topClients = totals.topClients as TopClient[];
  return <section className="workspace"><div className="page-title"><h1>Business performance</h1></div><div className="stat-grid">{[["Lifetime invoiced",totals.invoiced],["Lifetime collected",totals.collected],["This month",totals.month],["Tax on invoices",totals.tax]].map(([label,value])=><article key={label}><span>{label}</span><strong>{formatMoney(Number(value),business.currency_code)}</strong></article>)}</div><div className="two-column"><section className="table-card"><h2>Collection health</h2><p>Outstanding overdue balance</p><strong>{formatMoney(totals.overdue,business.currency_code)}</strong></section><section className="table-card"><h2>Top clients</h2><table><thead><tr><th>Client</th><th>Invoiced</th><th>Collected</th></tr></thead><tbody>{topClients.map((client)=><tr key={client.id}><td>{client.name}</td><td>{formatMoney(client.invoiced,business.currency_code)}</td><td>{formatMoney(client.collected,business.currency_code)}</td></tr>)}</tbody></table></section></div></section>;
}
