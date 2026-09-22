const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { print, getPrinters } = require("pdf-to-printer");
const { WebSocketServer } = require("ws");

const API_BASE = process.env.KRYZER_PRINT_API || "https://app.kryzerdigital.com.br/api/kryzer-print";
const API_ORIGIN = new URL(API_BASE).origin;
const APP_VERSION = app.getVersion();
const PROTOCOL = "kryzer-print";
const PAPER_FORMATS = new Set(["10X15", "A4", "PRINTER_DEFAULT"]);
const UNIFIED_PORT = 21320;
const UNIFIED_ACCOUNTS = new Map([
  ["30945", { name: "MASTER", role: "MASTER", warehouse: "*" }],
  ["34552", { name: "Moto Cintra", role: "CLIENT", warehouse: "Master" }],
  ["33745", { name: "Giro X", role: "CLIENT", warehouse: "Master" }],
]);

let mainWindow = null;
let heartbeatTimer = null;
let jobsTimer = null;
let busy = false;
let unifiedServer = null;
const unifiedSockets = new Map();
const unifiedSnapshots = new Map();
const unifiedRequests = new Map();
let unifiedPrintChain = Promise.resolve();
let state = {
  paired: false,
  connected: false,
  printerName: null,
  labelPaperFormat: "10X15",
  documentPaperFormat: "A4",
  autoPrintLabel: true,
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

function normalizePaperFormat(value, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return PAPER_FORMATS.has(normalized) ? normalized : fallback;
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
      labelPaperFormat: normalizePaperFormat(config.labelPaperFormat, "10X15"),
      documentPaperFormat: normalizePaperFormat(config.documentPaperFormat, "A4"),
      autoPrintLabel: config.autoPrintLabel !== false,
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
    labelPaperFormat: state.labelPaperFormat,
    documentPaperFormat: state.documentPaperFormat,
    autoPrintLabel: state.autoPrintLabel,
  }, null, 2), "utf8");
}

function publicState() {
  return {
    paired: state.paired,
    connected: state.connected,
    printerName: state.printerName,
    labelPaperFormat: state.labelPaperFormat,
    documentPaperFormat: state.documentPaperFormat,
    autoPrintLabel: state.autoPrintLabel,
    agentId: state.agentId,
    lastSeen: state.lastSeen,
    lastError: state.lastError,
    lastJob: state.lastJob,
    appVersion: APP_VERSION,
    computerName: os.hostname(),
    unifiedPort: UNIFIED_PORT,
    unifiedConnections: [...unifiedSockets.values()].filter(Boolean).map(meta => ({
      puid: meta.puid,
      name: meta.name,
      role: meta.role,
      connectedAt: meta.connectedAt,
    })),
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
        labelPaperFormat: state.labelPaperFormat,
        documentPaperFormat: state.documentPaperFormat,
        autoPrintLabel: state.autoPrintLabel,
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


function unifiedPayload() {
  const now = Date.now();
  const sources = [...UNIFIED_ACCOUNTS.entries()].map(([puid, config]) => {
    const connected = [...unifiedSockets.values()].some(meta => meta?.puid === puid);
    const snapshot = unifiedSnapshots.get(puid) || null;
    return {
      puid,
      name: config.name,
      role: config.role,
      warehouse: config.warehouse,
      connected,
      updatedAt: snapshot?.updatedAt || null,
      stale: !snapshot?.updatedAt || (now - new Date(snapshot.updatedAt).getTime()) > 90000,
      orders: Array.isArray(snapshot?.orders) ? snapshot.orders : [],
      diagnostics: snapshot?.diagnostics || null,
    };
  });
  return { type: "unified_state", generatedAt: new Date().toISOString(), sources };
}

function broadcastUnifiedState() {
  const payload = JSON.stringify(unifiedPayload());
  for (const [socket, meta] of unifiedSockets.entries()) {
    if (meta?.puid !== "30945" || socket.readyState !== 1) continue;
    try { socket.send(payload); } catch {}
  }
  emitState();
}


function sendUnified(socket, payload) {
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function socketForPuid(puid) {
  for (const [socket, meta] of unifiedSockets.entries()) {
    if (meta?.puid === String(puid) && socket.readyState === 1) return socket;
  }
  return null;
}

function failUnifiedRequest(requester, requestId, error) {
  sendUnified(requester, {
    type: "action_response",
    requestId,
    ok: false,
    error: String(error || "Falha na ação remota."),
  });
}

async function printUnifiedLabel(url) {
  let tempFile = null;
  try {
    tempFile = await downloadToTemp(url);
    await print(tempFile, printOptions({ job_type: "LABEL", copies: 1 }));
    return { ok: true };
  } finally {
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
  }
}

function startUnifiedBridge() {
  if (unifiedServer) return;
  try {
    unifiedServer = new WebSocketServer({ host: "127.0.0.1", port: UNIFIED_PORT });
  } catch (error) {
    state.lastError = `Falha ao iniciar Checkout Unificado na porta ${UNIFIED_PORT}: ${error?.message || error}`;
    emitState();
    return;
  }

  unifiedServer.on("connection", socket => {
    unifiedSockets.set(socket, null);

    socket.on("message", raw => {
      let message;
      try { message = JSON.parse(String(raw || "{}")); } catch { return; }

      if (message.type === "register") {
        const puid = String(message.puid || "").trim();
        const allowed = UNIFIED_ACCOUNTS.get(puid);
        if (!allowed) {
          try { socket.send(JSON.stringify({ type: "error", error: "PUID_NOT_ALLOWED" })); } catch {}
          try { socket.close(1008, "PUID não autorizado"); } catch {}
          return;
        }
        unifiedSockets.set(socket, {
          puid,
          name: allowed.name,
          role: allowed.role,
          connectedAt: new Date().toISOString(),
        });
        try {
          socket.send(JSON.stringify({
            type: "registered",
            puid,
            name: allowed.name,
            role: allowed.role,
            warehouse: allowed.warehouse,
            port: UNIFIED_PORT,
          }));
          if (puid === "30945") socket.send(JSON.stringify(unifiedPayload()));
        } catch {}
        broadcastUnifiedState();
        return;
      }

      const meta = unifiedSockets.get(socket);
      if (!meta) return;

      if (message.type === "snapshot") {
        const puid = String(message.puid || meta.puid);
        if (puid !== meta.puid || !UNIFIED_ACCOUNTS.has(puid)) return;
        unifiedSnapshots.set(puid, {
          updatedAt: new Date().toISOString(),
          orders: Array.isArray(message.orders) ? message.orders : [],
          diagnostics: message.diagnostics || null,
        });
        broadcastUnifiedState();
        return;
      }


      if (message.type === "action_request") {
        if (meta.puid !== "30945") {
          failUnifiedRequest(socket, message.requestId, "Somente o MASTER pode iniciar ações.");
          return;
        }

        const requestId = String(message.requestId || "").trim();
        const targetPuid = String(message.targetPuid || "").trim();
        if (!requestId || !UNIFIED_ACCOUNTS.has(targetPuid)) {
          failUnifiedRequest(socket, requestId, "Destino/PUID inválido.");
          return;
        }

        const targetSocket = socketForPuid(targetPuid);
        if (!targetSocket) {
          failUnifiedRequest(socket, requestId, `PUID ${targetPuid} está offline.`);
          return;
        }

        const timer = setTimeout(() => {
          const pending = unifiedRequests.get(requestId);
          if (!pending) return;
          unifiedRequests.delete(requestId);
          failUnifiedRequest(pending.requester, requestId, "Tempo esgotado aguardando a conta de origem.");
        }, 60000);

        unifiedRequests.set(requestId, {
          requester: socket,
          targetPuid,
          timer,
          createdAt: Date.now(),
        });

        sendUnified(targetSocket, {
          type: "action_request",
          requestId,
          fromPuid: meta.puid,
          targetPuid,
          action: String(message.action || ""),
          payload: message.payload || {},
        });
        return;
      }

      if (message.type === "action_response") {
        const requestId = String(message.requestId || "").trim();
        const pending = unifiedRequests.get(requestId);
        if (!pending || pending.targetPuid !== meta.puid) return;
        clearTimeout(pending.timer);
        unifiedRequests.delete(requestId);
        sendUnified(pending.requester, {
          type: "action_response",
          requestId,
          ok: message.ok === true,
          result: message.result || null,
          error: message.error || null,
          sourcePuid: meta.puid,
        });
        return;
      }

      if (message.type === "unified_print_request") {
        if (meta.puid !== "30945") return;
        const requestId = String(message.requestId || "").trim();
        const url = String(message.url || "").trim();
        if (!requestId || !/^https?:\/\//i.test(url)) {
          sendUnified(socket, { type: "unified_print_result", requestId, ok: false, error: "URL de impressão inválida." });
          return;
        }

        unifiedPrintChain = unifiedPrintChain
          .catch(() => {})
          .then(() => printUnifiedLabel(url))
          .then(() => {
            sendUnified(socket, { type: "unified_print_result", requestId, ok: true });
          })
          .catch(error => {
            sendUnified(socket, {
              type: "unified_print_result",
              requestId,
              ok: false,
              error: error?.message || String(error),
            });
          });
        return;
      }

      if (message.type === "ping") {
        try { socket.send(JSON.stringify({ type: "pong", at: new Date().toISOString() })); } catch {}
      }
    });

    socket.on("close", () => {
      unifiedSockets.delete(socket);
      broadcastUnifiedState();
    });
    socket.on("error", () => {});
  });

  unifiedServer.on("listening", () => {
    state.lastError = null;
    emitState();
  });
  unifiedServer.on("error", error => {
    state.lastError = `Checkout Unificado: ${error?.message || error}`;
    emitState();
  });
}

async function downloadToTemp(url) {
  let headers = {};
  try {
    const parsed = new URL(url);
    if (parsed.origin === API_ORIGIN && state.token) headers = { "x-kryzer-print-token": state.token };
  } catch {
    // URL inválida será tratada pelo fetch abaixo
  }
  const response = await fetch(url, { redirect: "follow", headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.slice(0, 400) || `Não foi possível baixar o arquivo para impressão (${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = path.join(app.getPath("temp"), `kryzer-print-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`);
  await fs.writeFile(file, bytes);
  return file;
}

function printOptions(job) {
  const isLabel = String(job.job_type || "").toUpperCase() === "LABEL";
  const paperFormat = isLabel ? state.labelPaperFormat : state.documentPaperFormat;
  const printerName = job.printer_name || state.printerName || undefined;
  const options = {
    copies: Math.max(1, Number(job.copies || 1)),
    silent: true,
    ...(printerName ? { printer: printerName } : {}),
  };
  if (paperFormat === "A4") {
    options.paperSize = "A4";
    options.scale = "fit";
  } else if (paperFormat === "10X15") {
    options.paperSize = "4x6";
    options.scale = "noscale";
  }
  return options;
}

async function processJobs() {
  if (busy || !state.token || !state.connected) return;
  busy = true;
  let tempFile = null;
  try {
    const result = await api("/jobs", { method: "GET" });
    const job = result.job;
    if (!job) return;

    state.lastJob = { id: job.id, status: "PROCESSING", createdAt: job.created_at, jobType: job.job_type };
    emitState();

    tempFile = await downloadToTemp(job.source_url);
    await print(tempFile, printOptions(job));

    await api("/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, status: "PRINTED" }),
    });
    state.lastJob = { id: job.id, status: "PRINTED", createdAt: job.created_at, jobType: job.job_type };
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
    width: 660,
    height: 780,
    minWidth: 600,
    minHeight: 700,
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
  return printers.map((printer) => ({ name: printer.name, paperSizes: printer.paperSizes || [] }));
});
ipcMain.handle("print:set-printer", async (_event, printerName) => {
  state.printerName = String(printerName || "").trim() || null;
  await saveConfig();
  await heartbeat();
  return publicState();
});
ipcMain.handle("print:set-settings", async (_event, settings = {}) => {
  state.labelPaperFormat = normalizePaperFormat(settings.labelPaperFormat, state.labelPaperFormat);
  state.documentPaperFormat = normalizePaperFormat(settings.documentPaperFormat, state.documentPaperFormat);
  if (typeof settings.autoPrintLabel === "boolean") state.autoPrintLabel = settings.autoPrintLabel;
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
  startUnifiedBridge();
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
  try { unifiedServer?.close(); } catch {}
  app.quit();
});
