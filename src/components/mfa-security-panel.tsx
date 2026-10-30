"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string | null };

export function MfaSecurityPanel({ initialFactorId, initialAssurance }: { initialFactorId?: string; initialAssurance?: string }) {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(initialFactorId ? { id: initialFactorId } : null);
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(initialFactorId ? `Authenticator protected · current session ${initialAssurance ?? "aal1"}.` : "No authenticator is enrolled.");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const supabase = createClient();
    const [{ data: factors, error }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (error) { setMessage("Could not load multi-factor authentication status."); return; }
    const verified = (factors?.totp ?? [])[0] as Factor | undefined;
    setFactor(verified ?? null);
    setMessage(verified ? `Authenticator protected · current session ${assurance?.currentLevel ?? "aal1"}.` : "No authenticator is enrolled.");
  }

  async function startEnrollment() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "MfaroInvoice authenticator" });
    setBusy(false);
    if (error || !data) { setMessage("Enrollment could not start. Try again."); return; }
    setFactorId(data.id);
    setSecret(data.totp.secret);
    setMessage("Add this secret to an authenticator app, then enter its six-digit code to confirm.");
  }

  async function verifyEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const verificationFactorId = factorId || factor?.id;
    if (!verificationFactorId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: verificationFactorId });
    const { error } = challengeError || !challenge ? { error: challengeError ?? new Error("Challenge failed") } : await supabase.auth.mfa.verify({ factorId: verificationFactorId, challengeId: challenge.id, code });
    setBusy(false);
    if (error) { setMessage("That code was not accepted. Check the clock in your authenticator app and try again."); return; }
    setSecret(""); setFactorId(""); setCode(""); await refresh(); router.refresh();
  }

  async function removeFactor() {
    if (!factor || !window.confirm("Remove this authenticator? Security actions will no longer have MFA protection.")) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
    setBusy(false);
    if (error) { setMessage("The authenticator could not be removed."); return; }
    setFactor(null); setMessage("Authenticator removed.");
  }

  return <section className="form-card security-panel"><p className="eyebrow">ACCOUNT PROTECTION</p><h2>Authenticator app</h2><p>{message}</p>{factor && <form onSubmit={verifyEnrollment}><label>Verify this session<input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0,6))} required /></label><button className="button" disabled={busy || code.length !== 6}>Verify session</button></form>}{factor ? <button className="button danger-button" type="button" onClick={() => void removeFactor()} disabled={busy}>Remove authenticator</button> : !factorId ? <button className="button" type="button" onClick={() => void startEnrollment()} disabled={busy}>Set up authenticator</button> : <form onSubmit={verifyEnrollment}><label>Setup secret<code className="setup-secret">{secret}</code></label><p className="notice">Keep this secret private. Enter it manually in your authenticator app; it is never saved by MfaroInvoice.</p><label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label><button className="button" disabled={busy || code.length !== 6}>Verify and enable</button></form>}</section>;
}
