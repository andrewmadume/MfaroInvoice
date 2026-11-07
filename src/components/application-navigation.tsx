import type { ReactNode } from "react";

/** The same navigation frame is rendered by Next.js and the bundled desktop UI. */
export function ApplicationNavigation({
  brand,
  navigation,
  actions,
  name,
}: {
  brand: ReactNode;
  navigation: ReactNode;
  actions?: ReactNode;
  name: string;
}) {
  return (
    <header className="app-nav">
      {brand}
      <nav aria-label="Business navigation">{navigation}</nav>
      {actions}
      <span className="business-name">{name}</span>
    </header>
  );
}
