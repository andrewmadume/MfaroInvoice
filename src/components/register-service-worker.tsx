"use client";
import { useEffect, useState } from "react";
export function RegisterServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker>(),
    [offline, setOffline] = useState(false);
  useEffect(() => {
    if (window.mfaroDesktop || !("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    const status = () => {
        setOffline(!navigator.onLine);
        if (navigator.onLine && registration)
          void registration.update().catch(() => undefined);
      },
      dirty = (event: Event) => {
        if ((event.target as HTMLElement)?.closest?.(".offline-workspace"))
          return;
        window.mfaroDirty = true;
      },
      clean = () => {
        window.mfaroDirty = false;
      };
    status();
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    document.addEventListener("input", dirty);
    document.addEventListener("submit", clean);
    void navigator.serviceWorker
      .getRegistration("/")
      .then(
        (r) => r || navigator.serviceWorker.register("/sw.js", { scope: "/" }),
      )
      .then((r) => {
        registration = r;
        if (r.waiting) setWaiting(r.waiting);
        r.addEventListener("updatefound", () => {
          const worker = r.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(worker);
          });
        });
        if (navigator.onLine) void r.update().catch(() => undefined);
      })
      .catch(() => undefined);
    const timer = setInterval(() => void registration?.update(), 3600000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
      document.removeEventListener("input", dirty);
      document.removeEventListener("submit", clean);
    };
  }, []);
  return (
    <aside className="pwa-status" aria-live="polite">
      {offline && (
        <p>
          Offline.{" "}
          <a href="/offline/index.html">
            Open saved invoices and device drafts
          </a>
        </p>
      )}
      {waiting && (
        <p>
          An update is ready. Save your work first.{" "}
          <button
            type="button"
            onClick={() => {
              if (window.mfaroDirty) {
                alert("Save or close your unfinished edits before updating.");
                return;
              }
              if (
                !confirm(
                  "Refresh this window to apply the update? Check other MfaroInvoice windows for unsaved work first.",
                )
              )
                return;
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => window.location.reload(),
                { once: true },
              );
              waiting.postMessage({ type: "ACTIVATE_UPDATE" });
            }}
          >
            Update & refresh
          </button>
        </p>
      )}
    </aside>
  );
}
