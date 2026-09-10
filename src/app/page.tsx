const features = [
  ["Professional invoices", "Create branded invoices, calculate tax, and send them with confidence."],
  ["Payment tracking", "See what is paid, outstanding, and overdue at a glance."],
  ["Built for teams", "Give every colleague the access they need—nothing more."],
];

export default function Home() {
  return <main>
    <nav className="nav"><a className="brand" href="#top"><span>M</span>MfaroInvoice</a><div><a href="#features">Features</a><a href="/login">Sign in</a><a className="button small" href="/register">Get started</a></div></nav>
    <section id="top" className="hero">
      <div><p className="eyebrow">SMART BUSINESS FINANCE</p><h1>Your business.<br /><em>Your growth.</em></h1><p className="lead">A simple, professional invoicing and business management platform built to help African businesses create invoices, manage clients, track payments and grow.</p><div className="actions"><a className="button" href="/register">Start invoicing free</a><a className="text-link" href="/login">Sign in →</a></div></div>
      <div className="invoice-card" aria-label="Invoice preview"><div className="card-head"><span>MFARO</span><b>INVOICE</b></div><p className="muted">Invoice #INV-00024</p><div className="line wide"/><div className="line"/><div className="line short"/><div className="total"><span>Total due</span><b>R 12,450.00</b></div><div className="paid">✓ Ready to send</div></div>
    </section>
    <section id="features" className="features"><p className="eyebrow">ONE PLACE TO RUN THE BUSINESS</p><h2>Clarity for every invoice.</h2><div className="feature-grid">{features.map(([title, body], i) => <article key={title}><span className="num">0{i + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <footer>© {new Date().getFullYear()} MfaroInvoice · Your Business. Your Invoices. Your Growth.</footer>
  </main>;
}
