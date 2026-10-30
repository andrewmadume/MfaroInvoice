import { MfaSecurityPanel } from "@/components/mfa-security-panel";
import { setBusinessMfaRequirement, updateMemberAccess } from "@/app/app/actions";
import { createClient } from "@/lib/supabase/server";

type Search = { saved?: string; error?: string };

export default async function SecurityPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Search> }) {
  const { businessId } = await params; const query = await searchParams; const supabase = await createClient();
  const [{ data: business }, { data: members }, { data: permissions }, { data: overrides }, { data: factors }, { data: assurance }] = await Promise.all([
    supabase.from("businesses").select("mfa_required").throwOnError().eq("id", businessId).maybeSingle(),
    supabase.from("business_users").select("user_id,role,status").throwOnError().eq("business_id", businessId).eq("status", "active").order("created_at"),
    supabase.from("permissions").select("code,description").throwOnError().order("code"),
    supabase.from("business_user_permissions").select("user_id,permission_code,granted").throwOnError().eq("business_id", businessId),
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const memberOverrides = new Map((overrides ?? []).map((item) => [`${item.user_id}:${item.permission_code}`, item.granted]));
  const factor = (factors?.totp ?? [])[0];
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">PHASE 4 SECURITY</p><h1>Access & security</h1></div></div>{query.saved && <p className="success">Security settings saved.</p>}{query.error && <p className="alert" role="alert">The change was not applied. Multi-factor step-up may be required.</p>}<div className="two-column"><MfaSecurityPanel initialFactorId={factor?.id} initialAssurance={assurance?.currentLevel ?? undefined} /><section className="form-card security-panel"><p className="eyebrow">BUSINESS POLICY</p><h2>Require MFA for administrators</h2><p>Admins must have an authenticator and complete a step-up session before changing member access or this policy.</p><form action={setBusinessMfaRequirement}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="required" value={business?.mfa_required ? "false" : "true"} /><button className="button">{business?.mfa_required ? "Disable requirement" : "Require MFA"}</button></form></section></div><section className="table-card team-access"><h2>Member access</h2><p className="notice">Changes to another member’s role or direct permissions require your current session to be MFA verified. You cannot remove your own access or the last administrator.</p>{members?.length ? members.map((member) => <details key={member.user_id}><summary><strong>{member.role}</strong><span>{member.user_id}</span></summary><form action={updateMemberAccess}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="memberId" value={member.user_id} /><label>Role<select name="role" defaultValue={member.role}><option value="admin">Administrator</option><option value="accountant">Accountant</option><option value="staff">Staff</option></select></label><div className="permission-grid">{permissions?.map((permission) => { const current = memberOverrides.get(`${member.user_id}:${permission.code}`); return <label key={permission.code}><span>{permission.description}</span><select name={`permission:${permission.code}`} defaultValue={current === undefined ? "inherit" : current ? "grant" : "deny"}><option value="inherit">Inherit role</option><option value="grant">Grant</option><option value="deny">Deny</option></select></label>; })}</div><button className="button">Save member access</button></form></details>) : <p className="empty-state">You do not have permission to view or manage members.</p>}</section></section>;
}
