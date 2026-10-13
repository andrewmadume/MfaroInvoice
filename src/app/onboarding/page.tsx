import Link from "next/link";
import { createBusiness } from "@/app/(auth)/actions";

export default function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) { return <OnboardingForm searchParams={searchParams} />; }
async function OnboardingForm({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="auth"><Link href="/" className="brand"><span>M</span>MfaroInvoice</Link><section><p className="eyebrow">BUSINESS SETUP</p><h1>Create your business.</h1>{error && <p role="alert">We could not create the business. The slug may already be in use.</p>}<form action={createBusiness}><label>Business name<input name="name" required minLength={2} maxLength={160} /></label><label>Business slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="slug-help" /></label><p id="slug-help">Lowercase letters, numbers and hyphens only.</p><label>Currency<select name="currency" defaultValue="ZAR"><option value="ZAR">ZAR — South African rand</option><option value="USD">USD — US dollar</option><option value="ZWL">ZWL — Zimbabwean dollar</option></select></label><button className="button" type="submit">Create business</button></form></section></main>;
}
