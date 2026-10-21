import Link from "next/link";
import { InstallAppButton } from "@/components/install-app-button";
import { BrandLogo } from "@/components/brand-logo";

const entries = [["Overview", ""], ["Invoices", "/invoices"], ["Quotes", "/quotes"], ["Recurring", "/recurring"], ["Clients", "/clients"], ["Inventory", "/inventory"], ["Time", "/time"], ["Documents", "/documents"], ["Reports", "/reports"], ["Analytics", "/analytics"], ["Payments", "/payments"], ["Sync", "/sync"], ["Security", "/security"], ["Settings", "/settings"]];

export function BusinessNav({ businessId, name }: { businessId: string; name: string }) {
  return <header className="app-nav"><Link className="brand brand-logo" href="/"><BrandLogo compact /></Link><nav>{entries.map(([label, suffix]) => <Link key={label} href={`/app/${businessId}${suffix}`}>{label}</Link>)}</nav><InstallAppButton /><span className="business-name">{name}</span></header>;
}
