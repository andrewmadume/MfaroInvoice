import Image from "next/image";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <Image className={`brand-logo-image${compact ? " brand-logo-image-compact" : ""}`} src="/MfaroInvoice-logo.svg" alt="MfaroInvoice" width={1254} height={1254} priority />;
}
