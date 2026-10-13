import Link from "next/link";
import { InstallAppButton } from "@/components/install-app-button";

const entries = [["Overview", ""], ["Invoices", "/invoices"], ["Quotes", "/quotes"], ["Recurring", "/recurring"], ["Clients", "/clients"], ["Inventory", "/inventory"], ["Time", "/time"], ["Documents", "/documents"], ["Reports", "/reports"], ["Payments", "/payments"], ["Settings", "/settings"]];

export function BusinessNav({ businessId, name }: { businessId: string; name: string }) {
  return <header className="app-nav"><Link className="brand" href="/"><span>M</span>MfaroInvoice</Link><nav>{entries.map(([label, suffix]) => <Link key={label} href={`/app/${businessId}${suffix}`}>{label}</Link>)}</nav><InstallAppButton /><span className="business-name">{name}</span></header>;
}
