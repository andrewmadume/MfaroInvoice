"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(12).max(1024) });
const registrationSchema = credentialsSchema.extend({ businessName: z.string().trim().min(2).max(160) });
const businessSchema = z.object({ name: z.string().trim().min(2).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160), currency: z.string().regex(/^[A-Z]{3}$/) });

function errorRedirect(path: string, code: string): never { redirect(`${path}?error=${encodeURIComponent(code)}`); }
function applicationUrl(): string { const configured = process.env.NEXT_PUBLIC_SITE_URL; if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL must be configured"); return configured.replace(/\/$/, ""); }

/** Authenticates through Supabase Auth. Passwords are never stored or logged. */
export async function login(formData: FormData) {
  const parsed = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) errorRedirect("/login", "invalid-credentials");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) errorRedirect("/login", "sign-in-failed");
  redirect("/app");
}

export async function register(formData: FormData) {
  const parsed = registrationSchema.safeParse({ businessName: formData.get("businessName"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) errorRedirect("/register", "invalid-registration");
  const supabase = await createClient();
  const { error, data } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { emailRedirectTo: `${applicationUrl()}/auth/confirm` } });
  if (error) errorRedirect("/register", "registration-failed");
  if (!data.session) redirect("/check-email");
  redirect("/onboarding");
}

export async function createBusiness(formData: FormData) {
  const parsed = businessSchema.safeParse({ name: formData.get("name"), slug: formData.get("slug"), currency: formData.get("currency") });
  if (!parsed.success) errorRedirect("/onboarding", "invalid-business");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("create_business", { business_name: parsed.data.name, business_slug: parsed.data.slug, currency: parsed.data.currency });
  if (error) errorRedirect("/onboarding", "business-creation-failed");
  redirect("/app");
}

export async function confirmEmail(code: string | undefined) {
  if (!code) redirect("/login?error=invalid-confirmation-link");
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) errorRedirect("/login", "confirmation-failed");
  redirect("/onboarding");
}
