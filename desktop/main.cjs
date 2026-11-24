const {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  dialog,
  Menu,
  shell,
  safeStorage,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { allowedExternal, allowedSender, assetPath } = require("./security.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "mfaro",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win;
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.on("before-quit", () => {
  quitting = true;
});
const origin = "mfaro://app";
const publicRoot = path.join(__dirname, "../public");
const config = require("../public/offline/config.json");
const cloudOrigin = new URL(config.supabaseUrl).origin;
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${cloudOrigin}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
function checked(handler) {
  return async (event, ...args) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !allowedSender(event.senderFrame.url)
    )
      throw new Error("Untrusted sender");
    return handler(...args);
  };
}
function credentialFile() {
  return path.join(app.getPath("userData"), "session.enc");
}
async function secureCredentials() {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === "linux" &&
      (!safeStorage.isEncryptionAvailable() ||
        safeStorage.getSelectedStorageBackend() === "basic_text"))
  )
    throw new Error(
      "A secure operating-system credential store is required to sign in. Enable your system keyring.",
    );
}
async function saveFile(kind, text) {
  if (
    !["backup", "pdf"].includes(kind) ||
    (kind === "backup" &&
      (typeof text !== "string" || Buffer.byteLength(text) > 10485760))
  )
    throw new Error("Invalid export");
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: kind === "pdf" ? "Export invoice PDF" : "Export private backup",
    defaultPath:
      kind === "pdf" ? "MfaroInvoice.pdf" : "MfaroInvoice-backup.json",
    filters: [
      {
        name: kind === "pdf" ? "PDF" : "JSON backup",
        extensions: [kind === "pdf" ? "pdf" : "json"],
      },
    ],
  });
  if (canceled || !filePath) return false;
  const bytes =
    kind === "pdf"
      ? await win.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
        })
      : Buffer.from(text);
  const temporary = filePath + ".mfaro-part";
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return true;
}
app.setName("MfaroInvoice");
if (process.env.MFARO_SMOKE_PROFILE)
  app.setPath("userData", path.resolve(process.env.MFARO_SMOKE_PROFILE));
app.whenReady().then(async () => {
  protocol.handle("mfaro", async (request) => {
    const target = assetPath(request.url, publicRoot);
    if (!target) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.readFile(target);
      const headers = new Headers({
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[path.extname(target)] || "application/octet-stream",
      });
      headers.set("Content-Security-Policy", csp);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const u = new URL(details.url);
      allowed =
        (u.protocol === "mfaro:" && u.host === "app") ||
        u.origin === cloudOrigin;
    } catch {}
    callback({ cancel: !allowed });
  });
  win = new BrowserWindow({
    title: "MfaroInvoice",
    width: 1280,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: !process.argv.includes("--smoke-test"),
    icon: path.join(publicRoot, "icons/app-512-v3.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!allowedSender(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.on("close", (event) => {
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  ipcMain.handle(
    "mfaro:credential-get",
    checked(async () => {
      await secureCredentials();
      try {
        const decrypted = await safeStorage.decryptStringAsync(
          await fs.readFile(credentialFile()),
        );
        return decrypted.result;
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    }),
  );
  ipcMain.handle(
    "mfaro:credential-set",
    checked(async (value) => {
      if (value === null) {
        await fs.rm(credentialFile(), { force: true });
        return;
      }
      if (typeof value !== "string" || value.length > 100000)
        throw new Error("Invalid session");
      await secureCredentials();
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      const file = credentialFile();
      await fs.writeFile(
        file + ".tmp",
        await safeStorage.encryptStringAsync(value),
        { mode: 0o600 },
      );
      await fs.rename(file + ".tmp", file);
    }),
  );
  ipcMain.handle("mfaro:export", checked(saveFile));
  ipcMain.handle(
    "mfaro:import",
    checked(async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Restore MfaroInvoice backup",
        properties: ["openFile"],
        filters: [{ name: "JSON backup", extensions: ["json"] }],
      });
      if (canceled) return null;
      const stat = await fs.stat(filePaths[0]);
      if (!stat.isFile() || stat.size > 10485760)
        throw new Error("Backup must be a file under 10 MB");
      return fs.readFile(filePaths[0], "utf8");
    }),
  );
  ipcMain.handle(
    "mfaro:print",
    checked(
      () =>
        new Promise((resolve, reject) =>
          win.webContents.print({ printBackground: true }, (ok, reason) =>
            ok ? resolve() : reject(new Error(reason)),
          ),
        ),
    ),
  );
  ipcMain.handle(
    "mfaro:external",
    checked(async (url) => {
      if (!allowedExternal(url)) throw new Error("URL not approved");
      await shell.openExternal(url);
    }),
  );
  ipcMain.handle(
    "mfaro:version",
    checked(() => app.getVersion()),
  );
  app.setAboutPanelOptions({
    applicationName: "MfaroInvoice",
    applicationVersion: app.getVersion(),
    copyright: "MfaroInvoice · Your Business. Your Invoices. Your Growth.",
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "MfaroInvoice",
        submenu: [
          { label: "About MfaroInvoice", click: () => app.showAboutPanel() },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
  await win.loadURL(origin + "/offline/");
  if (process.argv.includes("--smoke-test")) {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const check = await win.webContents.executeJavaScript(
        `(async()=>({title:document.title,workspace:!!document.querySelector('.offline-workspace'),node:typeof window.require,process:typeof window.process,bridge:Object.keys(window.mfaroDesktop),storage:await new Promise((resolve,reject)=>{const r=indexedDB.open('mfaro-smoke',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>{const db=r.result;const t=db.transaction('records','readwrite');t.objectStore('records').put('survives restart','draft');t.oncomplete=()=>{db.close();resolve(true);};};r.onerror=()=>reject(r.error);})}))()`,
      );
      if (
        !check.workspace ||
        check.node !== "undefined" ||
        check.process !== "undefined" ||
        !check.storage
      )
        throw new Error(JSON.stringify(check));
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
      });
      const report = {
        ...check,
        pdfBytes: pdf.length,
        packaged: app.isPackaged,
        platform: process.platform,
      };
      if (process.env.MFARO_SMOKE_REPORT)
        await fs.writeFile(
          process.env.MFARO_SMOKE_REPORT,
          JSON.stringify(report, null, 2),
        );
      console.log(JSON.stringify(report));
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (win && !win.isDestroyed()) win.show();
});
