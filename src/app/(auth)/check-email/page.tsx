import Link from "next/link";

export default function CheckEmail() {
  return <main className="auth"><Link href="/" className="brand"><span>M</span>MfaroInvoice</Link><section><p className="eyebrow">ONE LAST STEP</p><h1>Check your email.</h1><p>We sent a confirmation link. After you confirm your email, you can create your business.</p><p><Link href="/login">Back to sign in</Link></p></section></main>;
}
