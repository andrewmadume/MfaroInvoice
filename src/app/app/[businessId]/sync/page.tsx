import { OfflineSyncPanel } from "@/components/offline-sync-panel";
import { createClient } from "@/lib/supabase/server";

export default async function SyncPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params; const supabase = await createClient();
  const [{ data: projects }, { data: products }] = await Promise.all([
    supabase.from("projects").select("id,name").throwOnError().eq("business_id", businessId).eq("active", true).order("name"),
    supabase.from("products").select("id,name").throwOnError().eq("business_id", businessId).order("name"),
  ]);
  return <OfflineSyncPanel businessId={businessId} projects={projects ?? []} products={products ?? []} />;
}
