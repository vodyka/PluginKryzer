const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kryzerPrint", {
  getState: () => ipcRenderer.invoke("print:get-state"),
  pair: (code) => ipcRenderer.invoke("print:pair", code),
  getPrinters: () => ipcRenderer.invoke("print:get-printers"),
  setPrinter: (printerName) => ipcRenderer.invoke("print:set-printer", printerName),
  retryNow: () => ipcRenderer.invoke("print:retry-now"),
  onState: (callback) => ipcRenderer.on("print:state", (_event, state) => callback(state)),
});
