"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InstallAppButton } from "@/components/install-app-button";
import { BrandLogo } from "@/components/brand-logo";

const entries = [["Overview", ""], ["Invoices", "/invoices"], ["Quotes", "/quotes"], ["Recurring", "/recurring"], ["Clients", "/clients"], ["Inventory", "/inventory"], ["Time", "/time"], ["Documents", "/documents"], ["Reports", "/reports"], ["Analytics", "/analytics"], ["Payments", "/payments"], ["Sync", "/sync"], ["Security", "/security"], ["Templates & settings", "/settings"]];

export function BusinessNav({ businessId, name }: { businessId: string; name: string }) {
  const pathname = usePathname();
  const basePath = `/app/${businessId}`;
  return <header className="app-nav"><Link className="brand brand-logo" href="/"><BrandLogo compact /></Link><nav aria-label="Business navigation">{entries.map(([label, suffix]) => {
    const href = `${basePath}${suffix}`;
    const active = pathname === href || (suffix !== "" && pathname.startsWith(`${href}/`));
    return <Link key={label} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</nav><InstallAppButton /><span className="business-name">{name}</span></header>;
}
