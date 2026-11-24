const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "mfaroDesktop",
  Object.freeze({
    credentials: Object.freeze({
      get: () => ipcRenderer.invoke("mfaro:credential-get"),
      set: (value) => ipcRenderer.invoke("mfaro:credential-set", value),
    }),
    exportFile: (kind, text) => ipcRenderer.invoke("mfaro:export", kind, text),
    importBackup: () => ipcRenderer.invoke("mfaro:import"),
    print: () => ipcRenderer.invoke("mfaro:print"),
    openExternal: (url) => ipcRenderer.invoke("mfaro:external", url),
    version: () => ipcRenderer.invoke("mfaro:version"),
  }),
);
