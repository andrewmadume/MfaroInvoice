"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InstallAppButton } from "@/components/install-app-button";
import { businessNavigation } from "@/lib/business-navigation";
import { ApplicationNavigation } from "@/components/application-navigation";
import { BrandLogo } from "@/components/brand-logo";

export function BusinessNav({
  businessId,
  name,
}: {
  businessId: string;
  name: string;
}) {
  const pathname = usePathname();
  const basePath = `/app/${businessId}`;
  return (
    <ApplicationNavigation
      name={name}
      brand={
        <Link className="brand brand-logo" href="/">
          <BrandLogo compact />
        </Link>
      }
      navigation={
        <>
          {businessNavigation.map(([label, suffix]) => {
            const href = `${basePath}${suffix}`;
            const active =
              pathname === href ||
              (suffix !== "" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={label}
                href={href}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
          <a href="/offline/index.html">Device workspace</a>
        </>
      }
      actions={<InstallAppButton />}
    />
  );
}
