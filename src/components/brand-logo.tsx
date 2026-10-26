import Image from "next/image";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <Image className={`brand-logo-image${compact ? " brand-logo-image-compact" : ""}`} src="/MfaroInvoice-logo.svg?v=20261026" alt="MfaroInvoice — Your Business. Your Invoices. Your Growth." width={1168} height={974} priority />;
}
