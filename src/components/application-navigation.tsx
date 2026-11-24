"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Responsive application sidebar and business header. */
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
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <>
      <aside className="app-nav" aria-label="Application sidebar">
        <div className="sidebar-brand">{brand}</div>
        <div className="sidebar-business">
          <span>Your business</span>
          <strong>{name}</strong>
        </div>
        <button
          className="sidebar-menu-toggle"
          type="button"
          ref={toggle}
          aria-controls={navigationId}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Menu
        </button>
        <p className="sidebar-section-title">Workspace</p>
        <nav
          id={navigationId}
          aria-label="Business navigation"
          data-expanded={menuOpen}
          onClick={(event) => {
            if ((event.target as Element).closest("a, button")) {
              setMenuOpen(false);
              if (toggle.current?.getClientRects().length) toggle.current.focus();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && toggle.current?.getClientRects().length) {
              setMenuOpen(false);
              toggle.current?.focus();
            }
          }}
        >
          {navigation}
        </nav>
        {actions && <div className="sidebar-actions">{actions}</div>}
      </aside>
      <header className="app-topbar">
        <span className="business-name">{name}</span>
        <span className="app-topbar-product">MfaroInvoice</span>
      </header>
    </>
  );
}
