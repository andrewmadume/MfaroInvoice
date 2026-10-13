import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BusinessNav } from "@/components/business-nav";

export default async function BusinessLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ businessId: string }> }>) {
  const { businessId } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id,name").eq("id", businessId).maybeSingle();
  if (!business) notFound();
  return <main className="app-shell"><BusinessNav businessId={businessId} name={business.name} />{children}</main>;
}
