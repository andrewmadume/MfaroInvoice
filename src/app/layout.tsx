import type { Metadata } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

export const metadata: Metadata = {
  title: "MfaroInvoice | Your Business. Your Invoices. Your Growth.",
  description: "Professional invoicing and business management for African businesses.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><RegisterServiceWorker />{children}</body></html>;
}
