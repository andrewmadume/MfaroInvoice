import type { Metadata } from "next";
import "./globals.css";
import "./phase3.css";
import "./branding.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

export const metadata: Metadata = {
  title: "MfaroInvoice | Your Business. Your Invoices. Your Growth.",
  description: "Professional invoicing and business management for African businesses.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/MfaroInvoice-icon.svg", apple: "/MfaroInvoice-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><RegisterServiceWorker />{children}</body></html>;
}
