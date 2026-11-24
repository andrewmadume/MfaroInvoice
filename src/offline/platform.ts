export interface DesktopBridge {
  credentials: {
    get(): Promise<string | null>;
    set(value: string | null): Promise<void>;
  };
  exportFile(kind: "backup" | "pdf", text?: string): Promise<boolean>;
  importBackup(): Promise<string | null>;
  print(): Promise<void>;
  openExternal(url: string): Promise<void>;
  version(): Promise<string>;
}
export const desktopStorageKey = "mfaro-desktop-session";
export function credentialStorage(credentials: DesktopBridge["credentials"]) {
  // Supabase also probes migration/verifier keys. They must never alias the session.
  return {
    async getItem(key: string) {
      return key === desktopStorageKey ? credentials.get() : null;
    },
    async setItem(key: string, value: string) {
      if (key !== desktopStorageKey)
        throw new Error(
          "Unsupported desktop authentication flow. Use the online app.",
        );
      await credentials.set(value);
    },
    async removeItem(key: string) {
      if (key === desktopStorageKey) await credentials.set(null);
    },
  };
}
declare global {
  interface Window {
    mfaroDesktop?: DesktopBridge;
    mfaroDirty?: boolean;
  }
}
export const platform = {
  async print() {
    if (window.mfaroDesktop) await window.mfaroDesktop.print();
    else window.print();
  },
  async pdf() {
    if (window.mfaroDesktop) return window.mfaroDesktop.exportFile("pdf");
    window.print();
    return true;
  },
  async exportBackup(text: string) {
    if (window.mfaroDesktop)
      return window.mfaroDesktop.exportFile("backup", text);
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "MfaroInvoice-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  },
  async importBackup() {
    if (window.mfaroDesktop) return window.mfaroDesktop.importBackup();
    return new Promise<string | null>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.oncancel = () => resolve(null);
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        if (f.size > 10_485_760)
          return reject(new Error("Backup must be under 10 MB"));
        f.text().then(resolve, reject);
      };
      input.click();
    });
  },
  async external(url: string) {
    if (window.mfaroDesktop) await window.mfaroDesktop.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  },
};
