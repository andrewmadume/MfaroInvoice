import { createAdminClient } from "@/lib/supabase/admin";

export async function finalizeProviderPayment(input: { provider: "paystack" | "flutterwave"; reference: string; amount: number; currency: string; paidAt?: string }) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Invalid payment amount");
  const { error } = await createAdminClient().rpc("finalize_provider_payment", {
    p_provider: input.provider, p_reference: input.reference, p_amount: input.amount,
    p_currency: input.currency, p_paid_at: input.paidAt ?? null,
  });
  if (error) throw new Error("Could not settle provider payment");
}
