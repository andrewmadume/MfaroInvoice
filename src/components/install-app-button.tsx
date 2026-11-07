"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => { const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); }; window.addEventListener("beforeinstallprompt", capture); return () => window.removeEventListener("beforeinstallprompt", capture); }, []);
  if (!prompt) return <details className="install-help"><summary>Install app</summary><p>iPhone / iPad: open in Safari → Share → Add to Home Screen → Open as Web App. On Android or desktop Chrome/Edge, use the browser menu’s Install app option. On supported macOS Safari, choose File → Add to Dock. If unavailable, bookmark this app.</p><a href="/offline/index.html">Prepare device for offline use</a></details>;
  return <button className="text-button install-button" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install app</button>;
}
