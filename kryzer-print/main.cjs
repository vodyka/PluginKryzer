const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { print, getPrinters } = require("pdf-to-printer");

const API_BASE = process.env.KRYZER_PRINT_API || "https://app.kryzerdigital.com.br/api/kryzer-print";
const APP_VERSION = app.getVersion();
const PROTOCOL = "kryzer-print";

let mainWindow = null;
let heartbeatTimer = null;
let jobsTimer = null;
let busy = false;
let state = {
  paired: false,
  connected: false,
  printerName: null,
  token: null,
  agentId: null,
  lastSeen: null,
  lastError: null,
  lastJob: null,
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.on("second-instance", () => focusWindow());
app.on("open-url", (event) => {
  event.preventDefault();
  focusWindow();
});

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

async function loadConfig() {
  try {
    const content = await fs.readFile(configPath(), "utf8");
    const config = JSON.parse(content);
    state = {
      ...state,
      paired: Boolean(config.token),
      token: config.token || null,
      agentId: config.agentId || null,
      printerName: config.printerName || null,
    };
  } catch {
    // primeira execução
  }
}

async function saveConfig() {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify({
    token: state.token,
    agentId: state.agentId,
    printerName: state.printerName,
  }, null, 2), "utf8");
}

function publicState() {
  return {
    paired: state.paired,
    connected: state.connected,
    printerName: state.printerName,
    agentId: state.agentId,
    lastSeen: state.lastSeen,
    lastError: state.lastError,
    lastJob: state.lastJob,
    appVersion: APP_VERSION,
    computerName: os.hostname(),
  };
}

function emitState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("print:state", publicState());
}

async function api(pathname, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.token) headers["x-kryzer-print-token"] = state.token;
  const response = await fetch(`${API_BASE}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha HTTP ${response.status}`);
  return body;
}

async function heartbeat() {
  if (!state.token) {
    state.connected = false;
    emitState();
    return;
  }
  try {
    await api("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printerName: state.printerName,
        appVersion: APP_VERSION,
        os: `${os.type()} ${os.release()}`,
      }),
    });
    state.connected = true;
    state.lastSeen = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.connected = false;
    state.lastError = error instanceof Error ? error.message : "Falha ao conectar ao Kryzer.";
  }
  emitState();
}

async function downloadToTemp(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Não foi possível baixar o arquivo para impressão (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = path.join(app.getPath("temp"), `kryzer-print-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`);
  await fs.writeFile(file, bytes);
  return file;
}

async function processJobs() {
  if (busy || !state.token || !state.connected) return;
  busy = true;
  let tempFile = null;
  try {
    const result = await api("/jobs", { method: "GET" });
    const job = result.job;
    if (!job) return;

    state.lastJob = { id: job.id, status: "PROCESSING", createdAt: job.created_at };
    emitState();

    tempFile = await downloadToTemp(job.source_url);
    const printerName = job.printer_name || state.printerName || undefined;
    await print(tempFile, {
      copies: Math.max(1, Number(job.copies || 1)),
      ...(printerName ? { printer: printerName } : {}),
    });

    await api("/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, status: "PRINTED" }),
    });
    state.lastJob = { id: job.id, status: "PRINTED", createdAt: job.created_at };
    state.lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao imprimir.";
    state.lastError = message;
    if (state.lastJob?.id && state.lastJob.status === "PROCESSING") {
      try {
        await api("/jobs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: state.lastJob.id, status: "ERROR", error: message }),
        });
        state.lastJob = { ...state.lastJob, status: "ERROR" };
      } catch {
        // mantém erro local visível
      }
    }
  } finally {
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
    busy = false;
    emitState();
  }
}

async function pair(code) {
  const printers = await getPrinters().catch(() => []);
  const selected = state.printerName || printers?.[0]?.name || null;
  const response = await fetch(`${API_BASE}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code,
      name: `Kryzer Print · ${os.hostname()}`,
      appVersion: APP_VERSION,
      os: `${os.type()} ${os.release()}`,
      printerName: selected,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Falha ao parear Kryzer Print.");
  state.token = body.token;
  state.agentId = body.agentId;
  state.printerName = selected;
  state.paired = true;
  await saveConfig();
  await heartbeat();
  return publicState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 540,
    minHeight: 640,
    title: "Kryzer Print",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

ipcMain.handle("print:get-state", async () => publicState());
ipcMain.handle("print:pair", async (_event, code) => pair(String(code || "").trim().toUpperCase()));
ipcMain.handle("print:get-printers", async () => {
  const printers = await getPrinters();
  return printers.map((printer) => ({ name: printer.name }));
});
ipcMain.handle("print:set-printer", async (_event, printerName) => {
  state.printerName = String(printerName || "").trim() || null;
  await saveConfig();
  await heartbeat();
  return publicState();
});
ipcMain.handle("print:retry-now", async () => {
  await heartbeat();
  await processJobs();
  return publicState();
});

app.whenReady().then(async () => {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
  await loadConfig();
  createWindow();
  await heartbeat();
  await processJobs();
  heartbeatTimer = setInterval(() => heartbeat(), 5_000);
  jobsTimer = setInterval(() => processJobs(), 2_000);
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  focusWindow();
});

app.on("window-all-closed", () => {
  clearInterval(heartbeatTimer);
  clearInterval(jobsTimer);
  app.quit();
});
