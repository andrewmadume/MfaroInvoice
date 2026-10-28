import type { Metadata } from "next";
import "./globals.css";
import "./phase3.css";
import "./branding.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

export const metadata: Metadata = {
  title: "MfaroInvoice | Your Business. Your Invoices. Your Growth.",
  description: "Professional invoicing and business management for African businesses.",
  manifest: "/manifest.webmanifest?v=20261028-icon3",
  icons: {
    icon: [{ url: "/icons/favicon-v3.png", sizes: "48x48", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-v3.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><RegisterServiceWorker />{children}</body></html>;
}
