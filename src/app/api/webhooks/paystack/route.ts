import { currencyDecimals } from "@/lib/finance";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { finalizeProviderPayment } from "@/lib/payment-finalization";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY; if (!secret) return NextResponse.json({ error: "not-configured" }, { status: 503 });
  const raw = await request.text(); const supplied = request.headers.get("x-paystack-signature") ?? ""; const expected = createHmac("sha512", secret).update(raw).digest("hex");
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return NextResponse.json({ error: "invalid-signature" }, { status: 401 });
  const event = JSON.parse(raw) as { event?: string; data?: { reference?: string; amount?: number; currency?: string; paid_at?: string } };
  if (event.event !== "charge.success" || !event.data?.reference) return NextResponse.json({ received: true });
  const verification = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(event.data.reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const verified = await verification.json() as { status?: boolean; data?: { status?: string; amount?: number; currency?: string; paid_at?: string; reference?: string } };
  if (!verified.status || verified.data?.status !== "success" || !verified.data.reference || typeof verified.data.amount !== "number" || !verified.data.currency) return NextResponse.json({ error: "verification-failed" }, { status: 400 });
  await finalizeProviderPayment({ provider: "paystack", reference: verified.data.reference, amount: verified.data.amount / 10 ** currencyDecimals(verified.data.currency), currency: verified.data.currency, paidAt: verified.data.paid_at });
  return NextResponse.json({ received: true });
}
