import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export default async function Dashboard() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login"); const { data: memberships, error } = await supabase.from("business_users").select("business_id").throwOnError().eq("status", "active").eq("user_id", user.id); if (error) throw new Error("Unable to load business memberships"); if (!memberships?.length) redirect("/onboarding"); redirect(`/app/${memberships[0].business_id}`); }
