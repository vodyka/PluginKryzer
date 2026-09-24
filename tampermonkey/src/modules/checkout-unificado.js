function initUnifiedCheckoutModule() {
  "use strict";

  const VERSION = "0.6.1";
  const WS_URLS = ["ws://127.0.0.1:21320", "ws://localhost:21320"];
  const HTTP_URLS = ["http://127.0.0.1:21321", "http://localhost:21321"];
  const CLOUD_REST_BASE = "https://iqpxkxixoirdkkcgbejz.supabase.co/rest/v1/v2_checkout_unified_snapshots";
  const CLOUD_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxcHhreGl4b2lyZGtrY2diZWp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5Nzc2MTQsImV4cCI6MjA5OTU1MzYxNH0.qWcx0D08Bs_evoEr1WLhdg7KayOhcgM-Hyt0Th_DLkU";
  const MASTER_PUID = "30945";
  const PARAM = "kzUnifiedCheckout";
  const SOURCE_PARAM = "kzUnifiedSource";
  const LABEL_PARAM = "kzCollectLabel";
  const ACCOUNTS = {
    "30945": { name: "MASTER", role: "MASTER", warehouse: "*" },
    "34552": { name: "Moto Cintra", role: "CLIENT", warehouse: "Master", masterWarehouseId: "2374395576103698" },
    "33745": { name: "Giro X", role: "CLIENT", warehouse: "Master", masterWarehouseId: "" },
  };

  let currentPuid = "";
  let currentAccount = null;
  let socket = null;
  let wsUrlIndex = 0;
  let httpBase = "";
  let httpBridgeOnline = false;
  let httpBridgeVersion = "";
  let httpBridgeLastError = "";
  let autoLaunchAttempted = false;
  let autoLaunchAt = 0;
  let httpPollTimer = null;
  let httpActionTimer = null;
  let cloudPollTimer = null;
  let cloudRelayOnline = false;
  let cloudRelayLastError = "";
  let snapshotHeartbeatTimer = null;
  let snapshotRefreshTimer = null;
  let reconnectTimer = null;
  let syncTimer = null;
  let pingTimer = null;
  let syncing = false;
  let lastState = null;
  let localMasterOrders = [];
  let localMasterUpdatedAt = null;
  let connectionError = "";
  let localMasterDiagnostics = null;
  let warehouseRegistry = [];
  let masterWarehouseId = "";
  let warehouseRegistryAt = 0;
  let searchText = "";
  let categoryFilter = "single1";
  let sourceFilter = "all";
  let channelFilter = "all";
  let onlyTodayFilter = false;
  let priorityFirstFilter = true;
  let skuQueueSearch = "";
  let checkoutSession = null;
  let lastScanMessage = "";
  let lastScanType = "info";
  let labelCollector = { status: "idle", orderNo: "", message: "", url: "", order: null };
  const pendingRemoteActions = new Map();
  const pendingLocalPrints = new Map();

  const isUnifiedPage = () => new URLSearchParams(location.search).get(PARAM) === "1";
  const isSourcePage = () => new URLSearchParams(location.search).get(SOURCE_PARAM) === "1";
  const labelTarget = () => norm(new URLSearchParams(location.search).get(LABEL_PARAM));
  const norm = value => String(value == null ? "" : value).trim();
  const fold = value => norm(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const escapeHtml = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function masterWarehouseStorageKey() {
    return "kzu_master_warehouse_" + norm(currentPuid || "");
  }

  function readStoredMasterWarehouseId() {
    try { return norm(localStorage.getItem(masterWarehouseStorageKey())); } catch (_) { return ""; }
  }

  function saveStoredMasterWarehouseId(id) {
    try {
      const value = norm(id);
      if (value) localStorage.setItem(masterWarehouseStorageKey(), value);
      else localStorage.removeItem(masterWarehouseStorageKey());
    } catch (_) {}
  }

  async function getCurrentPuid() {
    const response = await fetch("/api/home", { credentials: "include" });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("Não consegui ler /api/home nesta sessão.");
    }
    const json = await response.json();
    return norm(
      json && json.data && json.data.user && (json.data.user.puid || json.data.user.id) ||
      json && json.user && (json.user.puid || json.user.id) ||
      json && json.data && (json.data.puid || json.data.id)
    );
  }

  function waitForCheckoutBridge(timeoutMs) {
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        const bridge = window.KZCheckoutRapido || (typeof unsafeWindow !== "undefined" ? unsafeWindow.KZCheckoutRapido : null);
        if (bridge && typeof bridge.snapshotUnificado === "function") return resolve(bridge);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }



  async function cloudRest(method, url, data = null, extraHeaders = {}, timeout = 8000) {
    const headers = {
      "apikey": CLOUD_ANON_KEY,
      "Authorization": "Bearer " + CLOUD_ANON_KEY,
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    let gmError = null;

    if (typeof GM_xmlhttpRequest === "function") {
      try {
        return await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method,
            url,
            data: data == null ? undefined : JSON.stringify(data),
            headers,
            timeout,
            onload: response => {
              const text = response.responseText || "";
              let json = null;
              try { json = text ? JSON.parse(text) : null; } catch (_) {}
              if (response.status < 200 || response.status >= 300) {
                reject(new Error((json && (json.message || json.error || json.hint)) || ("HTTP " + response.status + " " + text.slice(0,180))));
                return;
              }
              resolve(json);
            },
            onerror: () => reject(new Error("Falha ao acessar o relay Supabase.")),
            ontimeout: () => reject(new Error("Timeout no relay Supabase.")),
          });
        });
      } catch (error) {
        gmError = error;
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        method,
        mode: "cors",
        cache: "no-store",
        headers,
        body: data == null || method === "GET" ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      if (!response.ok) throw new Error((json && (json.message || json.error || json.hint)) || ("HTTP " + response.status + " " + text.slice(0,180)));
      return json;
    } catch (fetchError) {
      const first = gmError && gmError.message ? gmError.message : "";
      const second = fetchError && fetchError.message ? fetchError.message : String(fetchError);
      throw new Error([first, second].filter(Boolean).join(" | ") || "Falha no relay Supabase.");
    }
  }

  async function publishSnapshotCloud(snapshotPayload) {
    try {
      const row = {
        puid: currentPuid,
        account_name: currentAccount?.name || currentPuid,
        role: currentAccount?.role || "CLIENT",
        orders: Array.isArray(snapshotPayload?.orders) ? snapshotPayload.orders : [],
        diagnostics: snapshotPayload?.diagnostics || null,
        updated_at: new Date().toISOString(),
      };
      await cloudRest(
        "POST",
        CLOUD_REST_BASE + "?on_conflict=puid",
        row,
        { "Prefer": "resolution=merge-duplicates,return=minimal" },
        8000
      );
      cloudRelayOnline = true;
      cloudRelayLastError = "";
      return true;
    } catch (error) {
      cloudRelayOnline = false;
      cloudRelayLastError = error && error.message ? error.message : String(error);
      return false;
    }
  }

  async function pollCloudState() {
    if (currentPuid !== MASTER_PUID) return;
    try {
      const rows = await cloudRest(
        "GET",
        CLOUD_REST_BASE + "?select=puid,account_name,role,orders,diagnostics,updated_at&puid=in.(30945,34552,33745)",
        null,
        {},
        8000
      );
      const now = Date.now();
      const byPuid = new Map((Array.isArray(rows) ? rows : []).map(row => [String(row.puid), row]));
      const sources = Object.entries(ACCOUNTS).map(([puid, config]) => {
        const row = byPuid.get(puid) || null;
        const updatedAt = row?.updated_at || null;
        const ageMs = updatedAt ? now - new Date(updatedAt).getTime() : Number.POSITIVE_INFINITY;
        return {
          puid,
          name: config.name,
          role: config.role,
          connected: ageMs <= 45000,
          stale: ageMs > 90000,
          updatedAt,
          transport: "cloud",
          orders: Array.isArray(row?.orders) ? row.orders : [],
          diagnostics: row?.diagnostics || null,
        };
      });
      lastState = {
        type: "unified_state",
        generatedAt: new Date().toISOString(),
        sources,
      };
      cloudRelayOnline = true;
      cloudRelayLastError = "";
      safeRenderUnified();
    } catch (error) {
      cloudRelayOnline = false;
      cloudRelayLastError = error && error.message ? error.message : String(error);
      safeRenderUnified();
    }
  }

  function isUnifiedRelayConnected() {
    return cloudRelayOnline;
  }

  async function gmJson(method, url, data = null, timeout = 6000) {
    let gmError = null;

    if (typeof GM_xmlhttpRequest === "function") {
      try {
        return await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method,
            url,
            data: data == null ? undefined : JSON.stringify(data),
            headers: { "Content-Type": "application/json" },
            timeout,
            onload: response => {
              try {
                const json = JSON.parse(response.responseText || "{}");
                if (response.status < 200 || response.status >= 300) {
                  reject(new Error(json.error || ("HTTP " + response.status)));
                  return;
                }
                resolve(json);
              } catch (_) {
                reject(new Error("Resposta local inválida."));
              }
            },
            onerror: () => reject(new Error("Falha GM na ponte HTTP local.")),
            ontimeout: () => reject(new Error("Timeout GM na ponte HTTP local.")),
          });
        });
      } catch (error) {
        gmError = error;
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        method,
        mode: "cors",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: data == null || method === "GET" ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || ("HTTP " + response.status));
      return json;
    } catch (fetchError) {
      const first = gmError && gmError.message ? gmError.message : "";
      const second = fetchError && fetchError.message ? fetchError.message : String(fetchError);
      throw new Error([first, second].filter(Boolean).join(" | ") || "Falha na ponte HTTP local.");
    }
  }


  function tryOpenKryzerPrint() {
    const now = Date.now();
    if (autoLaunchAttempted && now - autoLaunchAt < 30000) return false;
    autoLaunchAttempted = true;
    autoLaunchAt = now;
    try {
      const a = document.createElement("a");
      a.href = "kryzer-print://open";
      a.style.display = "none";
      document.documentElement.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function probeHttpBridgeWithLaunch() {
    if (await probeHttpBridge()) return true;
    const launched = tryOpenKryzerPrint();
    if (!launched) return false;

    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 750));
      if (await probeHttpBridge()) return true;
    }
    return false;
  }

  async function probeHttpBridge() {
    let lastError = "";
    for (const base of HTTP_URLS) {
      try {
        const result = await gmJson("GET", base + "/health", null, 2500);
        if (result && result.ok) {
          httpBase = base;
          httpBridgeOnline = true;
          httpBridgeVersion = norm(result.appVersion);
          httpBridgeLastError = "";
          return true;
        }
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      }
    }
    httpBase = "";
    httpBridgeOnline = false;
    httpBridgeVersion = "";
    httpBridgeLastError = lastError || "Kryzer Print HTTP não respondeu.";
    return false;
  }

  function isBridgeConnected() {
    return Boolean(socket && socket.readyState === WebSocket.OPEN) || httpBridgeOnline;
  }

  async function postSnapshotHttp(payload) {
    if (!httpBridgeOnline && !(await probeHttpBridge())) return false;
    try {
      await gmJson("POST", httpBase + "/snapshot", payload, 6000);
      httpBridgeOnline = true;
      return true;
    } catch (_) {
      httpBridgeOnline = false;
      return false;
    }
  }

  async function pollUnifiedStateHttp() {
    if (currentPuid !== MASTER_PUID) return;
    if (!httpBridgeOnline && !(await probeHttpBridge())) return;
    try {
      const result = await gmJson("GET", httpBase + "/state", null, 5000);
      if (result?.state) {
        lastState = result.state;
        httpBridgeOnline = true;
        safeRenderUnified();
      }
    } catch (_) {
      httpBridgeOnline = false;
    }
  }

  async function executeSourceActionCore(action, payload) {
    if (action === "collect_label") {
      const order = payload.order || {};
      const url = await collectLabelUrl(order);
      return { url };
    }
    if (action === "mark_print") {
      const result = await markOrderPrintedRemote(payload.order || {});
      setTimeout(() => publishSnapshot(true), 500);
      return result;
    }
    if (action === "refresh_snapshot") {
      await publishSnapshot(true);
      return { ok: true };
    }
    throw new Error("Ação remota desconhecida: " + action);
  }

  async function pollHttpActions() {
    if (!currentAccount) return;
    if (!httpBridgeOnline && !(await probeHttpBridge())) return;
    try {
      const result = await gmJson("GET", httpBase + "/actions?puid=" + encodeURIComponent(currentPuid), null, 5000);
      const actions = Array.isArray(result?.actions) ? result.actions : [];
      for (const message of actions) {
        let response;
        try {
          const value = await executeSourceActionCore(norm(message.action), message.payload || {});
          response = { puid: currentPuid, requestId: norm(message.requestId), ok: true, result: value };
        } catch (error) {
          response = { puid: currentPuid, requestId: norm(message.requestId), ok: false, error: error?.message || String(error) };
        }
        try { await gmJson("POST", httpBase + "/action-response", response, 6000); } catch (_) {}
      }
      httpBridgeOnline = true;
    } catch (_) {
      httpBridgeOnline = false;
    }
  }

  async function requestSourceActionHttp(targetPuid, action, payload, timeoutMs = 55000) {
    if (!httpBridgeOnline && !(await probeHttpBridge())) throw new Error("Ponte HTTP local desconectada.");
    const requestId = makeUnifiedRequestId("httpact");
    await gmJson("POST", httpBase + "/action-request", {
      fromPuid: MASTER_PUID,
      targetPuid: String(targetPuid || ""),
      requestId,
      action,
      payload: payload || {},
    }, 6000);

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 650));
      const result = await gmJson("GET", httpBase + "/action-result?requestId=" + encodeURIComponent(requestId), null, 5000);
      if (result?.pending) continue;
      const row = result?.response || {};
      if (row.ok === true) return row.result || {};
      throw new Error(row.error || "Falha na conta de origem.");
    }
    throw new Error("Tempo esgotado aguardando a conta de origem.");
  }

  async function requestLocalPrintHttp(url) {
    if (!httpBridgeOnline && !(await probeHttpBridge())) throw new Error("Kryzer Print HTTP desconectado.");
    const result = await gmJson("POST", httpBase + "/print", { fromPuid: MASTER_PUID, url }, 45000);
    if (!result?.ok) throw new Error(result?.error || "Falha ao imprimir.");
    return result;
  }

  function extractWarehouseRows(json) {
    const rows = [];
    const seen = new Set();

    function walk(node, depth) {
      if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        const warehouseLike = node.filter(row =>
          row && typeof row === "object" &&
          (row.warehouseId != null || row.warehouseIdStr != null) &&
          (row.warehouseName != null || row.name != null || row.isDefault != null || row.cou != null)
        );
        if (warehouseLike.length) rows.push(...warehouseLike);
        node.forEach(item => walk(item, depth + 1));
        return;
      }

      if ((node.warehouseId != null || node.warehouseIdStr != null) &&
          (node.warehouseName != null || node.name != null || node.isDefault != null || node.cou != null)) {
        rows.push(node);
      }

      Object.values(node).forEach(value => {
        if (value && typeof value === "object") walk(value, depth + 1);
      });
    }

    walk(json, 0);

    const unique = new Map();
    rows.forEach(row => {
      const id = norm(row && (row.warehouseId || row.warehouseIdStr || row.id || row.idStr));
      if (id && !unique.has(id)) unique.set(id, row);
    });
    return [...unique.values()];
  }

  async function loadWarehouseRegistry(force) {
    const now = Date.now();
    if (!force && warehouseRegistry.length && (now - warehouseRegistryAt) < 5 * 60 * 1000) {
      return warehouseRegistry;
    }
    try {
      const response = await fetch("/api/warehouse-sku/count", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({ searchType: "1", isGroup: 0 }),
      });
      const json = await response.json();
      if (!response.ok || (json && json.code != null && Number(json.code) !== 0)) {
        throw new Error((json && json.msg) || ("HTTP " + response.status));
      }
      warehouseRegistry = extractWarehouseRows(json).map(row => ({
        id: norm(row && (row.warehouseId || row.warehouseIdStr || row.id || row.idStr)),
        name: norm(row && (
          row.warehouseName || row.name || row.title || row.displayName ||
          row.warehouseTitle || row.whName || row.storehouseName || row.label
        )),
        count: Number(row && (row.cou ?? row.count ?? row.total ?? row.skuCount ?? 0)),
        isDefault: Boolean(row && (
          row.isDefault === true || Number(row.isDefault) === 1 ||
          row.defaultWarehouse === true || Number(row.defaultWarehouse) === 1 ||
          row.isMain === true || Number(row.isMain) === 1
        )),
      })).filter(row => row.id);
      warehouseRegistryAt = Date.now();

      const configuredMasterId = norm(currentAccount && currentAccount.masterWarehouseId);
      const storedMasterId = readStoredMasterWarehouseId();
      const masterByName = warehouseRegistry.find(row => fold(row.name) === "MASTER");
      const defaults = warehouseRegistry.filter(row => row.isDefault);
      masterWarehouseId = configuredMasterId ||
        storedMasterId ||
        (masterByName ? masterByName.id : "") ||
        (defaults.length === 1 ? defaults[0].id : "");

      console.log("[Kryzer Unified] armazéns", currentPuid, warehouseRegistry, "Master:", masterWarehouseId || "não encontrado", "config:", configuredMasterId || "nenhum", "salvo:", storedMasterId || "nenhum");
      return warehouseRegistry;
    } catch (error) {
      console.warn("[Kryzer Unified] falha ao descobrir armazéns:", error);
      warehouseRegistry = [];
      masterWarehouseId = "";
      warehouseRegistryAt = Date.now();
      return [];
    }
  }

  function warehouseNameById(id) {
    const key = norm(id);
    const row = warehouseRegistry.find(item => item.id === key);
    return row ? row.name : "";
  }

  function allowedWarehouse(order) {
    if (!currentAccount || currentAccount.role !== "CLIENT") return true;
    const orderWarehouseId = norm(order && (order.warehouseId || order.warehouseIdStr));
    if (masterWarehouseId) return orderWarehouseId === masterWarehouseId;
    return fold(order && order.warehouseName) === "MASTER";
  }

  function buildDiagnostics(all, filtered) {
    const warehouseCounts = {};
    (all || []).forEach(order => {
      const id = norm(order && (order.warehouseId || order.warehouseIdStr || order.warehouseName));
      const resolvedName = warehouseNameById(id);
      const label = resolvedName ? (resolvedName + " [" + id + "]") : (norm(order && order.warehouseName) || id || "Sem armazém");
      warehouseCounts[label] = (warehouseCounts[label] || 0) + 1;
    });
    return {
      rawCount: Array.isArray(all) ? all.length : 0,
      filteredCount: Array.isArray(filtered) ? filtered.length : 0,
      warehouseCounts,
      warehouseOrderCounts: (all || []).reduce((acc, order) => {
        const id = norm(order && (order.warehouseId || order.warehouseIdStr || order.warehouseName));
        if (id) acc[id] = (acc[id] || 0) + 1;
        return acc;
      }, {}),
      warehouseRegistry,
      masterWarehouseId,
      currentPuid,
      accountName: currentAccount && currentAccount.name,
      role: currentAccount && currentAccount.role,
      expectedWarehouse: currentAccount && currentAccount.warehouse,
      at: new Date().toISOString(),
    };
  }

  function serializeOrders(orders) {
    return (orders || []).filter(allowedWarehouse).map(order => ({
      sourcePuid: currentPuid,
      sourceName: currentAccount.name,
      sourceRole: currentAccount.role,
      idStr: norm(order.idStr),
      authIdStr: norm(order.authIdStr),
      orderNo: norm(order.orderNo),
      sku: norm(order.sku),
      title: norm(order.title),
      image: norm(order.image),
      totalQty: Number(order.totalQty || 0),
      distinctSkuCount: Number(order.distinctSkuCount || 0),
      category: norm(order.category || "unknown"),
      verified: order.verified === true,
      eligible: order.eligible === true,
      channel: norm(order.channel),
      shopName: norm(order.shopName),
      warehouseId: norm(order.warehouseId),
      warehouseName: warehouseNameById(order.warehouseId) || norm(order.warehouseName),
      deadlineAt: norm(order.deadlineAt),
      priorityAt: norm(order.priorityAt),
      dueToday: order.dueToday === true,
      msgContent: norm(order.msgContent),
      realItems: (order.realItems || []).map(item => ({
        sku: norm(item.sku),
        qty: Number(item.qty || 0),
        title: norm(item.title),
        image: norm(item.image),
        scanAliases: Array.isArray(item.scanAliases) ? item.scanAliases.map(norm).filter(Boolean) : [],
      })),
      marketplaceItems: (order.marketplaceItems || []).map(item => ({
        sku: norm(item.sku),
        qty: Number(item.qty || 0),
        title: norm(item.title),
        image: norm(item.image),
        scanAliases: Array.isArray(item.scanAliases) ? item.scanAliases.map(norm).filter(Boolean) : [],
      })),
    }));
  }

  async function publishSnapshot(refreshFirst) {
    if (syncing || !currentAccount) return;
    syncing = true;
    try {
      const bridge = await waitForCheckoutBridge(8000);
      if (!bridge) throw new Error("Checkout base não carregou.");
      if (refreshFirst && typeof bridge.atualizarPedidosUnificado === "function") {
        try { await bridge.atualizarPedidosUnificado(); } catch (_) {}
      }
      const all = typeof bridge.snapshotUnificado === "function" ? bridge.snapshotUnificado() : [];
      if (currentAccount.role === "CLIENT") await loadWarehouseRegistry(false);
      const orders = serializeOrders(all);
      const diagnostics = buildDiagnostics(all, orders);

      if (currentPuid === MASTER_PUID) {
        localMasterOrders = orders;
        localMasterUpdatedAt = new Date().toISOString();
        localMasterDiagnostics = diagnostics;
      }

      const snapshotPayload = {
        type: "snapshot",
        puid: currentPuid,
        account: currentAccount.name,
        role: currentAccount.role,
        orders: [
          ...orders,
          {
            __kzDiagnostic: true,
            sourcePuid: currentPuid,
            diagnostics,
          }
        ],
        diagnostics,
      };

      // O relay em nuvem é a fonte oficial da unificação.
      publishSnapshotCloud(snapshotPayload).catch(() => {});

      // Pontes locais antigas ficam como fallback, mas não são necessárias
      // para juntar os pedidos das três contas.
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(snapshotPayload));
      }
      postSnapshotHttp(snapshotPayload).catch(() => {});

      connectionError = "";
      console.log("[Kryzer Unified] snapshot", currentPuid, orders.length, "de", all.length);
      safeRenderUnified();
      renderSourcePage();
    } catch (error) {
      connectionError = error && error.message ? error.message : String(error);
      console.warn("[Kryzer Unified] falha ao sincronizar:", error);
      safeRenderUnified();
      renderSourcePage();
    } finally {
      syncing = false;
    }
  }


  function makeUnifiedRequestId(prefix) {
    const random = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return (prefix || "req") + "-" + random;
  }

  function requestSourceAction(targetPuid, action, payload, timeoutMs = 55000) {
    if (httpBridgeOnline) return requestSourceActionHttp(targetPuid, action, payload, timeoutMs);
    return new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        probeHttpBridge().then(ok => {
          if (ok) requestSourceActionHttp(targetPuid, action, payload, timeoutMs).then(resolve,reject);
          else reject(new Error("Kryzer Print/ponte local está desconectada."));
        });
        return;
      }
      const requestId = makeUnifiedRequestId("act");
      const timer = setTimeout(() => {
        pendingRemoteActions.delete(requestId);
        reject(new Error("Tempo esgotado aguardando a conta de origem."));
      }, timeoutMs);

      pendingRemoteActions.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({
        type: "action_request",
        requestId,
        targetPuid: String(targetPuid || ""),
        action,
        payload: payload || {},
      }));
    });
  }

  function requestLocalPrint(url, timeoutMs = 45000) {
    if (httpBridgeOnline) return requestLocalPrintHttp(url);
    return new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Kryzer Print está desconectado."));
        return;
      }
      const requestId = makeUnifiedRequestId("print");
      const timer = setTimeout(() => {
        pendingLocalPrints.delete(requestId);
        reject(new Error("Tempo esgotado aguardando a impressão."));
      }, timeoutMs);
      pendingLocalPrints.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({
        type: "unified_print_request",
        requestId,
        url,
      }));
    });
  }

  async function markOrderPrintedRemote(order) {
    const body = new URLSearchParams();
    body.set("isBatch", "0");
    body.set("mark", "1");
    body.set("markType", "0");
    body.append("orderIdList[0]", norm(order && (order.idStr || order.id)));
    const json = await postFormUnified("/api/order/mark-print", body);
    if (json && json.code != null && Number(json.code) !== 0) {
      throw new Error(json.msg || "Falha ao marcar pedido como impresso.");
    }
    return { ok: true };
  }

  async function executeSourceAction(message) {
    const requestId = norm(message && message.requestId);
    const action = norm(message && message.action);
    const payload = message && message.payload || {};
    if (!requestId || !socket || socket.readyState !== WebSocket.OPEN) return;

    try {
      const result = await executeSourceActionCore(action, payload);

      socket.send(JSON.stringify({
        type: "action_response",
        requestId,
        ok: true,
        result,
      }));
    } catch (error) {
      socket.send(JSON.stringify({
        type: "action_response",
        requestId,
        ok: false,
        error: error && error.message ? error.message : String(error),
      }));
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSocket, 2500);
  }

  function connectSocket() {
    if (!currentAccount) return;
    try { socket && socket.close(); } catch (_) {}
    connectionError = "";
    try {
      socket = new WebSocket(WS_URLS[wsUrlIndex % WS_URLS.length]);
    } catch (error) {
      connectionError = error && error.message ? error.message : "Falha ao abrir conexão local.";
      safeRenderUnified();
      renderSourcePage();
      scheduleReconnect();
      return;
    }

    const openTimeout = setTimeout(() => {
      if (!socket || socket.readyState === WebSocket.OPEN) return;
      connectionError = "Kryzer Print não respondeu em " + WS_URLS[wsUrlIndex % WS_URLS.length] + ". Tentando rota alternativa...";
      try { socket.close(); } catch (_) {}
      safeRenderUnified();
      renderSourcePage();
    }, 4000);

    socket.addEventListener("open", () => {
      clearTimeout(openTimeout);
      connectionError = "";
      socket.send(JSON.stringify({
        type: "register",
        puid: currentPuid,
        account: currentAccount.name,
        role: currentAccount.role,
        moduleVersion: VERSION,
      }));
      publishSnapshot(true);
      clearInterval(syncTimer);
      syncTimer = setInterval(() => publishSnapshot(false), 10000);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 15000);
      safeRenderUnified();
      renderSourcePage();
    });

    socket.addEventListener("message", event => {
      let message = null;
      try { message = JSON.parse(String(event.data || "{}")); } catch (_) { return; }
      if (message.type === "action_request") {
        executeSourceAction(message);
        return;
      }

      if (message.type === "action_response") {
        const pending = pendingRemoteActions.get(norm(message.requestId));
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingRemoteActions.delete(norm(message.requestId));
        if (message.ok === true) pending.resolve(message.result || {});
        else pending.reject(new Error(message.error || "Falha na conta de origem."));
        return;
      }

      if (message.type === "unified_print_result") {
        const pending = pendingLocalPrints.get(norm(message.requestId));
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingLocalPrints.delete(norm(message.requestId));
        if (message.ok === true) pending.resolve(message);
        else pending.reject(new Error(message.error || "Falha ao imprimir."));
        return;
      }

      if (message.type === "unified_state" && currentPuid === MASTER_PUID) {
        lastState = message;
        safeRenderUnified();
      renderSourcePage();
      }
      if (message.type === "error") {
        connectionError = "Kryzer Print recusou a conexão: " + String(message.error || "erro");
        console.warn("[Kryzer Unified]", message.error);
        safeRenderUnified();
      renderSourcePage();
      }
    });

    socket.addEventListener("close", () => {
      clearTimeout(openTimeout);
      wsUrlIndex = (wsUrlIndex + 1) % WS_URLS.length;
      if (!connectionError) connectionError = "Kryzer Print local não está conectado. Próxima tentativa: " + WS_URLS[wsUrlIndex] + ".";
      safeRenderUnified();
      renderSourcePage();
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (!connectionError) connectionError = "Não foi possível conectar em " + WS_URLS[wsUrlIndex % WS_URLS.length] + ".";
      safeRenderUnified();
      renderSourcePage();
    });
  }



  function extractOrderListFromResponse(json) {
    const candidates = [
      json && json.data && json.data.list,
      json && json.data && json.data.records,
      json && json.data && json.data.orderList,
      json && json.data && json.data.page && json.data.page.list,
      json && json.list,
      json && json.records,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  async function postFormUnified(url, params) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("A sessão do UpSeller não retornou JSON. Faça login novamente nesta conta.");
    }
    const json = await response.json();
    if (!response.ok) throw new Error((json && json.msg) || ("HTTP " + response.status));
    return json;
  }

  async function findOrderByVisibleNumber(orderNo) {
    const target = norm(orderNo).toUpperCase();
    const attempts = [
      { orderState: "in_process", labelStatus: "success" },
      { orderState: "in_process" },
      { orderState: "allocate" },
      {},
    ];

    for (const extra of attempts) {
      const body = new URLSearchParams();
      const params = {
        timeType: 0,
        searchType: 0,
        searchValue: target,
        sortName: 1,
        sortValue: 0,
        isVoided: 0,
        pageNum: 1,
        pageSize: 100,
        warehouseType: 0,
        ...extra,
      };
      Object.entries(params).forEach(([key, value]) => {
        if (value !== "" && value != null) body.set(key, String(value));
      });
      const json = await postFormUnified("/api/order/index", body);
      const list = extractOrderListFromResponse(json);
      const exact = list.find(order => norm(order && (order.orderNumber || order.orderNo || order.commonNo || order.platformOrderNo)).toUpperCase() === target);
      if (exact) return exact;
    }
    return null;
  }

  async function collectLabelUrl(order) {
    const idStr = norm(order && (order.idStr || order.id));
    const authIdStr = norm(order && (order.authIdStr || order.authId));
    const orderNo = norm(order && (order.orderNumber || order.orderNo || order.commonNo || order.platformOrderNo));
    if (!idStr) throw new Error("Pedido sem idStr interno.");
    if (!authIdStr) throw new Error("Pedido " + (orderNo || idStr) + " sem authIdStr.");

    const prepBody = new URLSearchParams();
    prepBody.append("orderIdList[0]", idStr);
    const prep = await postFormUnified("/api/order/get-print-label-order", prepBody);
    if (prep && prep.code != null && Number(prep.code) !== 0) {
      throw new Error(prep.msg || "Falha ao preparar etiqueta.");
    }

    const printBody = new URLSearchParams();
    printBody.set("isCos", "1");
    printBody.set("printIdStr", idStr);
    printBody.set("authIdStr", authIdStr);
    printBody.set("isBatchPrint", "1");
    const printJson = await postFormUnified("/api/print-label", printBody);
    const uuid = typeof printJson.data === "string"
      ? printJson.data
      : norm(printJson && printJson.data && (printJson.data.uuid || printJson.data.id) || printJson && printJson.uuid);
    if (!uuid) throw new Error("O UpSeller não retornou o UUID da etiqueta.");

    for (let attempt = 1; attempt <= 30; attempt++) {
      labelCollector.message = "Gerando etiqueta · tentativa " + attempt + "/30";
      renderLabelCollector();
      await new Promise(resolve => setTimeout(resolve, 650));
      const response = await fetch("/api/check-process?uuid=" + encodeURIComponent(uuid), { credentials: "include" });
      const json = await response.json();
      let processMsg = json && json.data && json.data.processMsg;
      if (typeof processMsg === "string") {
        try { processMsg = JSON.parse(processMsg); } catch (_) {}
      }
      if (processMsg && (processMsg.code === 1 || processMsg.code === "1")) {
        const url = norm(processMsg.msg || processMsg.url || processMsg.data && processMsg.data.url);
        if (!url) throw new Error("A etiqueta terminou sem URL de PDF.");
        return new URL(url, location.origin).href;
      }
      if (processMsg && (processMsg.code === -1 || processMsg.code === "-1")) {
        const fail = processMsg.msg || processMsg.data && processMsg.data.failList && processMsg.data.failList[0] && processMsg.data.failList[0].msg;
        throw new Error(fail || "O UpSeller informou falha ao gerar a etiqueta.");
      }
    }
    throw new Error("Tempo esgotado aguardando o PDF da etiqueta.");
  }

  async function startLabelCollectorStandalone(orderNo) {
    labelCollector = { status: "loading", orderNo, message: "Identificando a conta UpSeller atual...", url: "", order: null };
    renderLabelCollector();

    try {
      const puid = await getCurrentPuid();
      currentPuid = puid;
      currentAccount = ACCOUNTS[currentPuid] || null;

      if (currentPuid !== "34552") {
        throw new Error("Este teste da etiqueta " + orderNo + " deve ser aberto na Moto Cintra (PUID 34552). PUID atual: " + (currentPuid || "não identificado") + ".");
      }

      labelCollector.message = "Moto Cintra identificada. Localizando o pedido...";
      renderLabelCollector();
      await runLabelCollector(orderNo);
    } catch (error) {
      labelCollector.status = "error";
      labelCollector.message = error && error.message ? error.message : String(error);
      renderLabelCollector();
    }
  }

  async function runLabelCollector(orderNo) {
    if (!orderNo || labelCollector.status === "loading") return;
    labelCollector = { status: "loading", orderNo, message: "Localizando pedido na conta atual...", url: "", order: null };
    renderLabelCollector();

    try {
      const order = await findOrderByVisibleNumber(orderNo);
      if (!order) throw new Error("Pedido " + orderNo + " não foi encontrado nesta conta UpSeller.");

      const orderWarehouseId = norm(order.warehouseIdStr || order.warehouseId || "");
      labelCollector.order = {
        idStr: norm(order.idStr || order.id),
        authIdStr: norm(order.authIdStr || order.authId),
        orderNo: norm(order.orderNumber || order.orderNo || order.commonNo || order.platformOrderNo),
        shopName: norm(order.shopName),
        warehouseId: orderWarehouseId,
        warehouseName: warehouseNameById(orderWarehouseId) || norm(order.warehouseName),
      };
      labelCollector.message = "Pedido localizado. Solicitando PDF da etiqueta...";
      renderLabelCollector();

      const url = await collectLabelUrl(order);
      labelCollector.status = "success";
      labelCollector.url = url;
      labelCollector.message = "Etiqueta coletada com sucesso. O pedido NÃO foi marcado como impresso.";
    } catch (error) {
      labelCollector.status = "error";
      labelCollector.message = error && error.message ? error.message : String(error);
    }
    renderLabelCollector();
  }

  function renderLabelCollector() {
    if (!labelTarget()) return;
    injectStyles();
    let root = document.getElementById("kzu-label-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-label-root";
      root.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#f5f6f8;overflow:auto;font-family:Inter,Arial,sans-serif;color:#172033";
      document.body.appendChild(root);
    }

    const statusText = labelCollector.status === "success" ? "Etiqueta encontrada" :
      labelCollector.status === "error" ? "Falha ao coletar" :
      labelCollector.status === "loading" ? "Coletando etiqueta..." : "Aguardando";
    const order = labelCollector.order || {};
    root.innerHTML =
      "<div style=\"max-width:850px;margin:50px auto;padding:0 20px\">" +
        "<div style=\"background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:22px\">" +
          "<div style=\"font-size:12px;font-weight:800;color:#667085\">TESTE DE ETIQUETA · SEM MARK-PRINT</div>" +
          "<h1 style=\"font-size:24px;margin:8px 0 4px\">" + escapeHtml(labelCollector.orderNo || labelTarget()) + "</h1>" +
          "<div style=\"color:#667085;margin-bottom:18px\">PUID atual: " + escapeHtml(currentPuid || "identificando...") + (currentAccount ? " · " + escapeHtml(currentAccount.name) : "") + "</div>" +
          "<div style=\"padding:14px;border-radius:10px;background:" + (labelCollector.status === "error" ? "#fef3f2" : labelCollector.status === "success" ? "#ecfdf3" : "#f9fafb") + ";border:1px solid #eaecf0\">" +
            "<b>" + escapeHtml(statusText) + "</b><div style=\"margin-top:5px;color:#475467\">" + escapeHtml(labelCollector.message || "") + "</div>" +
          "</div>" +
          (order.idStr ? "<div style=\"margin-top:16px;font-size:13px;line-height:1.7\"><b>idStr:</b> " + escapeHtml(order.idStr) + "<br><b>Loja:</b> " + escapeHtml(order.shopName || "-") + "<br><b>Armazém:</b> " + escapeHtml(order.warehouseName || order.warehouseId || "-") + "</div>" : "") +
          (labelCollector.url ? "<div style=\"margin-top:18px\"><a href=\"" + escapeHtml(labelCollector.url) + "\" target=\"_blank\" rel=\"noopener\" style=\"display:inline-flex;align-items:center;height:44px;padding:0 16px;border-radius:8px;background:#101828;color:white;text-decoration:none;font-weight:800\">Abrir PDF da etiqueta</a><div style=\"margin-top:10px;font-size:11px;color:#667085;word-break:break-all\">" + escapeHtml(labelCollector.url) + "</div></div>" : "") +
          (labelCollector.status === "error" ? "<div style=\"margin-top:18px\"><button id=\"kzu-label-retry\" class=\"kzu-btn active\">Tentar novamente</button></div>" : "") +
        "</div>" +
      "</div>";

    root.querySelector("#kzu-label-retry")?.addEventListener("click", () => {
      labelCollector = { status: "idle", orderNo: labelTarget(), message: "", url: "", order: null };
      runLabelCollector(labelTarget());
    });
  }

  function normalizeScan(value) {
    return norm(value).toUpperCase().replace(/[\s-]+/g, "");
  }

  function orderItemsForScan(order) {
    const items = (order && order.realItems && order.realItems.length)
      ? order.realItems
      : (order && order.marketplaceItems) || [];
    return items.map(item => ({
      sku: norm(item.sku),
      qty: Math.max(1, Number(item.qty || 1)),
      title: norm(item.title),
      image: norm(item.image),
      aliases: [...new Set([item.sku, ...(item.scanAliases || [])].map(normalizeScan).filter(Boolean))],
    })).filter(item => item.sku);
  }

  function itemMatchesCode(item, code) {
    const target = normalizeScan(code);
    return item && item.aliases && item.aliases.includes(target);
  }

  function remainingForItem(session, sku) {
    const required = Number(session.required[sku] || 0);
    const scanned = Number(session.scanned[sku] || 0);
    return Math.max(0, required - scanned);
  }

  function sessionComplete(session) {
    return Object.keys(session.required || {}).every(sku => remainingForItem(session, sku) === 0);
  }

  function startUnifiedCheckout(order, initialCode) {
    const items = orderItemsForScan(order);
    const required = {};
    items.forEach(item => { required[item.sku] = (required[item.sku] || 0) + item.qty; });
    checkoutSession = {
      sourcePuid: String(order.sourcePuid || ""),
      sourceName: order.sourceName || "",
      orderId: order.idStr,
      authIdStr: order.authIdStr,
      orderNo: order.orderNo,
      shopName: order.shopName || "",
      warehouseId: order.warehouseId || "",
      required,
      scanned: {},
      items,
      startedAt: new Date().toISOString(),
      complete: false,
      processing: false,
      stage: "SCANNING",
    };
    lastScanMessage = "Pedido " + (order.orderNo || order.idStr) + " iniciado.";
    lastScanType = "info";
    if (initialCode) applyScanToSession(initialCode);
  }

  function applyScanToSession(code) {
    if (!checkoutSession) return false;
    const item = checkoutSession.items.find(row => itemMatchesCode(row, code) && remainingForItem(checkoutSession, row.sku) > 0);
    if (!item) {
      const known = checkoutSession.items.find(row => itemMatchesCode(row, code));
      if (known) {
        lastScanMessage = "SKU " + known.sku + " já foi lido na quantidade necessária.";
      } else {
        lastScanMessage = "Código " + norm(code) + " não pertence ao pedido " + checkoutSession.orderNo + ".";
      }
      lastScanType = "error";
      return false;
    }
    checkoutSession.scanned[item.sku] = Number(checkoutSession.scanned[item.sku] || 0) + 1;
    checkoutSession.complete = sessionComplete(checkoutSession);
    if (checkoutSession.complete) {
      lastScanMessage = "✓ Pedido " + checkoutSession.orderNo + " conferido. Pronto para imprimir.";
      lastScanType = "success";
    } else {
      const missing = checkoutSession.items
        .filter(row => remainingForItem(checkoutSession, row.sku) > 0)
        .map(row => row.sku + " ×" + remainingForItem(checkoutSession, row.sku))
        .join(" · ");
      lastScanMessage = "✓ " + item.sku + " lido. Falta: " + missing;
      lastScanType = "success";
    }
    return true;
  }

  function findOrderForScan(code) {
    const target = normalizeScan(code);
    const candidates = allOrders()
      .filter(order => order.eligible !== false)
      .filter(order => orderItemsForScan(order).some(item => itemMatchesCode(item, target)))
      .sort((a,b) => {
        const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });
    return candidates[0] || null;
  }

  function handleUnifiedScan(value) {
    const code = normalizeScan(value);
    if (!code) return;
    if (checkoutSession && !checkoutSession.complete) {
      applyScanToSession(code);
      safeRenderUnified();
      return;
    }
    if (checkoutSession && checkoutSession.complete) {
      lastScanMessage = "Finalize ou cancele o pedido " + checkoutSession.orderNo + " antes de iniciar outro.";
      lastScanType = "error";
      safeRenderUnified();
      return;
    }
    const order = findOrderForScan(code);
    if (!order) {
      lastScanMessage = "Nenhum pedido pendente encontrado para " + norm(value) + ".";
      lastScanType = "error";
      safeRenderUnified();
      return;
    }
    startUnifiedCheckout(order, code);
    renderUnified();
  }


  async function finalizeUnifiedCheckout() {
    if (!checkoutSession || !checkoutSession.complete || checkoutSession.processing) return;

    const session = checkoutSession;
    session.processing = true;
    session.stage = "LABEL";
    lastScanType = "info";
    lastScanMessage = "Solicitando etiqueta à conta " + session.sourceName + "...";
    renderUnified();

    const orderPayload = {
      idStr: session.orderId,
      authIdStr: session.authIdStr,
      orderNumber: session.orderNo,
      orderNo: session.orderNo,
      shopName: session.shopName,
      warehouseId: session.warehouseId,
    };

    try {
      const label = await requestSourceAction(session.sourcePuid, "collect_label", { order: orderPayload });
      const pdfUrl = norm(label && label.url);
      if (!pdfUrl) throw new Error("A conta de origem não devolveu o PDF da etiqueta.");

      session.stage = "PRINT";
      lastScanMessage = "Etiqueta recebida. Imprimindo no Kryzer Print...";
      safeRenderUnified();

      await requestLocalPrint(pdfUrl);

      session.stage = "MARK";
      lastScanMessage = "Etiqueta impressa. Atualizando o pedido na conta de origem...";
      safeRenderUnified();

      await requestSourceAction(session.sourcePuid, "mark_print", { order: orderPayload }, 30000);

      lastScanMessage = "✓ " + session.orderNo + " separado e etiqueta impressa com sucesso.";
      lastScanType = "success";
      checkoutSession = null;

      try {
        await requestSourceAction(session.sourcePuid, "refresh_snapshot", {}, 15000);
      } catch (_) {}
      if (session.sourcePuid === MASTER_PUID) publishSnapshot(true).catch(() => {});
      safeRenderUnified();
      setTimeout(() => document.getElementById("kzu-scanner")?.focus(), 80);
    } catch (error) {
      if (checkoutSession) {
        checkoutSession.processing = false;
        checkoutSession.stage = "ERROR";
      }
      lastScanMessage = "Erro em " + session.orderNo + ": " + (error && error.message ? error.message : String(error));
      lastScanType = "error";
      safeRenderUnified();
    }
  }

  function sourceSummary() {
    const sourceMap = new Map();
    const knownSources = lastState && Array.isArray(lastState.sources) ? lastState.sources : [];
    Object.keys(ACCOUNTS).forEach(puid => {
      const config = ACCOUNTS[puid];
      const live = knownSources.find(row => String(row.puid) === puid) || {};
      const isLocalMaster = puid === MASTER_PUID && currentPuid === MASTER_PUID;
      const localOrders = isLocalMaster ? localMasterOrders : [];
      const rawLiveOrders = Array.isArray(live.orders) ? live.orders : [];
      const sentinel = rawLiveOrders.find(row => row && row.__kzDiagnostic === true);
      const liveOrders = rawLiveOrders.filter(row => !(row && row.__kzDiagnostic === true));
      sourceMap.set(puid, {
        puid: puid,
        name: config.name,
        role: config.role,
        warehouse: config.warehouse,
        connected: isLocalMaster ? true : live.connected === true,
        stale: isLocalMaster ? !localMasterUpdatedAt : live.stale !== false,
        updatedAt: isLocalMaster ? localMasterUpdatedAt : (live.updatedAt || null),
        transport: isLocalMaster ? "local" : (live.transport || null),
        orders: isLocalMaster ? localOrders : liveOrders,
        diagnostics: isLocalMaster ? localMasterDiagnostics : (live.diagnostics || sentinel?.diagnostics || null),
      });
    });
    return [...sourceMap.values()];
  }

  function allOrders() {
    return sourceSummary().flatMap(source => (source.orders || []).map(order => ({
      ...order,
      sourcePuid: source.puid,
      sourceName: source.name,
      sourceRole: source.role,
    })));
  }

  function matchesSearch(order) {
    const q = fold(searchText);
    if (!q) return true;
    const hay = [
      order.orderNo, order.sku, order.title, order.shopName, order.warehouseName,
      order.sourceName, order.channel,
      ...(order.realItems || []).flatMap(item => [item.sku, item.title, ...(item.scanAliases || [])]),
    ].map(fold).join(" ");
    return hay.includes(q);
  }

  function filteredOrders() {
    return allOrders().filter(order => {
      if (categoryFilter !== "all" && order.category !== categoryFilter) return false;
      if (sourceFilter !== "all" && String(order.sourcePuid) !== sourceFilter) return false;
      return matchesSearch(order);
    }).sort((a, b) => {
      const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });
  }

  function deadlineText(value) {
    if (!value) return "Sem prazo";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diff = date.getTime() - Date.now();
    if (diff < 0) {
      const mins = Math.floor(Math.abs(diff) / 60000);
      return "Atrasado " + Math.floor(mins / 60) + "h " + (mins % 60) + "m";
    }
    const mins = Math.floor(diff / 60000);
    return "Expira em " + Math.floor(mins / 60) + "h " + (mins % 60) + "m";
  }

  function injectStyles() {
    if (document.getElementById("kzu-style")) return;
    const style = document.createElement("style");
    style.id = "kzu-style";
    style.textContent = [
      "#kzqc-panel{display:none!important}",
      "#kzu-root{position:fixed;inset:0;z-index:2147483646;background:#f5f6f8;color:#172033;font-family:Inter,Arial,sans-serif;overflow:auto}",
      "#kzu-root *{box-sizing:border-box}",
      ".kzu-head{position:sticky;top:0;z-index:4;background:#fff;border-bottom:1px solid #e4e7ec;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px}",
      ".kzu-brand{display:flex;align-items:center;gap:12px}.kzu-logo{width:42px;height:42px;border-radius:10px;background:#101828;color:#fff;display:grid;place-items:center;font-weight:900;font-size:19px}",
      ".kzu-title{font-size:20px;font-weight:800}.kzu-sub{font-size:12px;color:#667085;margin-top:3px}",
      ".kzu-live{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700}.kzu-dot{width:9px;height:9px;border-radius:99px;background:#98a2b3}.kzu-live.on .kzu-dot{background:#12b76a}",
      ".kzu-page{padding:18px 22px 40px;max-width:1600px;margin:0 auto}",
      ".kzu-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}",
      ".kzu-source{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".kzu-source strong{display:block;font-size:15px}.kzu-source small{display:block;color:#667085;margin-top:3px}.kzu-source .count{font-size:24px;font-weight:900}",
      ".kzu-diag{margin-top:5px;font-size:11px;line-height:1.35;color:#475467}.kzu-diag b{font-weight:800}.kzu-diag .bad{color:#b42318}.kzu-diag .ok{color:#027a48}",
      ".kzu-source.off{opacity:.55}.kzu-source.client{border-left:4px solid #f79009}.kzu-source.master{border-left:4px solid #344054}",
      ".kzu-toolbar{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}",
      ".kzu-search{flex:1;min-width:220px;height:42px;border:1px solid #d0d5dd;border-radius:8px;padding:0 12px;font-size:14px;outline:none}.kzu-search:focus{border-color:#667085}",
      ".kzu-scanner{flex:1.2;min-width:300px;height:46px;border:2px solid #101828;border-radius:9px;padding:0 14px;font-size:17px;font-weight:800;outline:none;background:#fff}.kzu-scanner:focus{box-shadow:0 0 0 3px rgba(16,24,40,.12)}",
      ".kzu-session{background:#fff;border:2px solid #101828;border-radius:12px;padding:14px;margin-bottom:14px}.kzu-session-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.kzu-session-title{font-size:16px;font-weight:900}.kzu-session-sub{font-size:12px;color:#667085;margin-top:3px}.kzu-session-items{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.kzu-scan-item{padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;font-weight:800}.kzu-scan-item.done{background:#ecfdf3;border-color:#75e0a7;color:#027a48}.kzu-scan-item.wait{background:#fffaeb;border-color:#fedf89;color:#b54708}.kzu-scan-msg{margin-top:10px;font-size:13px;font-weight:800}.kzu-scan-msg.error{color:#b42318}.kzu-scan-msg.success{color:#027a48}",
      ".kzu-btn{height:38px;border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:0 12px;font-weight:700;color:#344054;cursor:pointer}.kzu-btn.active{background:#101828;color:#fff;border-color:#101828}",
      ".kzu-table{background:#fff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}",
      ".kzu-row{display:grid;grid-template-columns:120px 150px minmax(260px,1fr) 120px 150px 150px;gap:12px;align-items:center;padding:11px 14px;border-bottom:1px solid #eef1f4;min-height:70px}",
      ".kzu-row:last-child{border-bottom:0}.kzu-row.head{min-height:42px;background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#667085;font-weight:800}",
      ".kzu-origin{font-weight:800}.kzu-origin small{display:block;color:#667085;font-size:11px;margin-top:3px}",
      ".kzu-order{font-weight:800;font-size:13px}.kzu-product{display:flex;align-items:center;gap:10px;min-width:0}.kzu-product img{width:46px;height:46px;object-fit:cover;border-radius:7px;border:1px solid #eaecf0;background:#f2f4f7}",
      ".kzu-product b{font-size:13px}.kzu-product small{display:block;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px;margin-top:3px}",
      ".kzu-qty{font-size:20px;font-weight:900}.kzu-deadline{font-size:12px;font-weight:800}.kzu-deadline.late{color:#d92d20}",
      ".kzu-badge{display:inline-flex;padding:4px 7px;border-radius:999px;background:#f2f4f7;font-size:11px;font-weight:800;color:#475467}",
      ".kzu-empty{padding:50px;text-align:center;color:#667085}",
      ".kzu-alert{margin-bottom:14px;padding:12px 14px;border:1px solid #fecdca;background:#fef3f2;color:#b42318;border-radius:10px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".kzu-alert b{display:block;margin-bottom:2px}.kzu-alert small{color:#7a271a}.kzu-alert button{white-space:nowrap;height:34px;border:1px solid #f04438;background:#fff;color:#b42318;border-radius:7px;padding:0 10px;font-weight:800;cursor:pointer}",
      ".kzu-blocked{position:fixed;inset:0;z-index:2147483647;background:#101828;color:#fff;display:grid;place-items:center;font-family:Arial}.kzu-blocked>div{max-width:520px;text-align:center;padding:30px}.kzu-blocked h1{font-size:24px}.kzu-blocked p{color:#d0d5dd;line-height:1.6}",
      "@media(max-width:1000px){.kzu-sources{grid-template-columns:1fr}.kzu-row{grid-template-columns:110px 130px 1fr 80px}.kzu-row>*:nth-child(5),.kzu-row>*:nth-child(6){display:none}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function blockedPage(message) {
    injectStyles();
    let root = document.getElementById("kzu-blocked");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-blocked";
      root.className = "kzu-blocked";
      document.body.appendChild(root);
    }
    root.innerHTML = "<div><h1>Checkout Unificado Kryzer</h1><p>" + escapeHtml(message) + "</p></div>";
  }

  function renderSourcePage() {
    if (!isSourcePage()) return;
    injectStyles();

    let root = document.getElementById("kzu-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-root";
      document.body.appendChild(root);
    }

    if (!currentPuid || !currentAccount) {
      root.innerHTML = "<div class=\"kzu-page\"><div class=\"kzu-alert\"><span><b>Fonte não autorizada</b><small>Este PUID não participa do Checkout Unificado.</small></span></div></div>";
      return;
    }

    const connected = isUnifiedRelayConnected();
    const bridge = window.KZCheckoutRapido || (typeof unsafeWindow !== "undefined" ? unsafeWindow.KZCheckoutRapido : null);
    const raw = bridge && typeof bridge.snapshotUnificado === "function" ? bridge.snapshotUnificado() : [];
    const filtered = serializeOrders(raw);
    const rawWarehouseCounts = raw.reduce((acc, order) => {
      const id = norm(order && (order.warehouseId || order.warehouseIdStr || order.warehouseName));
      if (id) acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});
    const warehouseHtml = warehouseRegistry.length
      ? warehouseRegistry.map(row => {
          const selected = row.id === masterWarehouseId;
          const rawCount = Number(rawWarehouseCounts[row.id] || 0);
          return "<div style=\"display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid " + (selected ? "#12b76a" : "#e4e7ec") + ";border-radius:9px;background:" + (selected ? "#ecfdf3" : "#fff") + ";margin-top:8px\">" +
            "<div><b>" + escapeHtml(row.name || "Armazém sem nome") + "</b><small style=\"display:block;color:#667085;margin-top:3px\">ID " + escapeHtml(row.id) + " · " + rawCount + " pedido(s) bruto(s)" + (row.isDefault ? " · padrão" : "") + "</small></div>" +
            (selected
              ? "<span style=\"font-size:11px;font-weight:800;color:#027a48\">MASTER ATUAL</span>"
              : "<button class=\"kzu-btn\" data-set-master=\"" + escapeHtml(row.id) + "\">Usar como Master</button>") +
          "</div>";
        }).join("")
      : "<div style=\"color:#667085;font-size:12px\">Ainda não foi possível ler os armazéns.</div>";

    root.innerHTML =
      "<div class=\"kzu-head\"><div class=\"kzu-brand\"><div class=\"kzu-logo\">K</div><div><div class=\"kzu-title\">Fonte do Checkout Unificado</div><div class=\"kzu-sub\">" +
      escapeHtml(currentAccount.name) + " · PUID " + escapeHtml(currentPuid) + "</div></div></div>" +
      "<div class=\"kzu-live" + (connected ? " on" : "") + "\"><span class=\"kzu-dot\"></span>" + (connected ? "Relay Kryzer conectado" : "Desconectado") + "</div></div>" +
      "<div class=\"kzu-page\"><div class=\"kzu-source client\" style=\"margin-bottom:14px\"><span><strong>" + escapeHtml(currentAccount.name) + "</strong>" +
      "<small>PUID " + escapeHtml(currentPuid) + "</small>" +
      "<div class=\"kzu-diag\"><b>Pedidos brutos:</b> " + raw.length + " · <b>Enviados ao MASTER:</b> " + filtered.length +
      "<br><b>Master ID:</b> " + escapeHtml(masterWarehouseId || "não identificado") +
      "</div>" + warehouseHtml + "</span><span class=\"count\">" + filtered.length + "</span></div>" +
      "<div class=\"kzu-toolbar\"><button id=\"kzu-source-refresh\" class=\"kzu-btn active\">Atualizar e reenviar agora</button>" +
      "<button id=\"kzu-source-reconnect\" class=\"kzu-btn\">Testar relay</button>" +
      (!connected ? "<span style=\"font-size:11px;color:#b42318\">" + escapeHtml(cloudRelayLastError || "Relay ainda não respondeu.") + "</span>" : "") +
      "</div></div>";

    root.querySelectorAll("[data-set-master]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = norm(button.dataset.setMaster);
        if (!id) return;
        saveStoredMasterWarehouseId(id);
        masterWarehouseId = id;
        await publishSnapshot(true);
        renderSourcePage();
      });
    });

    root.querySelector("#kzu-source-reconnect")?.addEventListener("click", async () => {
      cloudRelayLastError = "";
      await publishSnapshot(true);
      if (currentPuid === MASTER_PUID) await pollCloudState();
      renderSourcePage();
    });

        root.querySelector("#kzu-source-refresh")?.addEventListener("click", async () => {
      await loadWarehouseRegistry(true);
      await publishSnapshot(true);
      renderSourcePage();
    });
  }


  function classicBaseOrders(sourceSnapshot) {
    let rows = Array.isArray(sourceSnapshot)
      ? sourceSnapshot.flatMap(source => (source.orders || []).map(order => ({
          ...order,
          sourcePuid: source.puid,
          sourceName: source.name,
          sourceRole: source.role,
        })))
      : allOrders();
    if (sourceFilter !== "all") rows = rows.filter(order => String(order.sourcePuid) === String(sourceFilter));
    if (channelFilter !== "all") rows = rows.filter(order => norm(order.channel).toLowerCase() === channelFilter);
    if (onlyTodayFilter) rows = rows.filter(order => order.dueToday === true);
    if (searchText) {
      const q = fold(searchText);
      rows = rows.filter(order => [
        order.orderNo, order.sku, order.title, order.shopName, order.sourceName, order.channel,
        ...(order.realItems || []).flatMap(item => [item.sku, item.title, ...(item.scanAliases || [])]),
      ].map(fold).join(" ").includes(q));
    }
    if (priorityFirstFilter) {
      rows = [...rows].sort((a,b) => {
        const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });
    }
    return rows;
  }


  function effectiveCategory(order) {
    if (["single1","singleMany","multiple"].includes(order?.category)) return order.category;
    const items = orderItemsForScan(order);
    const grouped = new Map();
    items.forEach(item => {
      const sku = norm(item.sku);
      if (!sku) return;
      grouped.set(sku, (grouped.get(sku) || 0) + Math.max(1, Number(item.qty || 1)));
    });
    const distinct = grouped.size;
    const total = [...grouped.values()].reduce((sum,n) => sum + Number(n || 0), 0);
    if (distinct === 1 && total === 1) return "single1";
    if (distinct === 1 && total > 1) return "singleMany";
    if (distinct > 1) return "multiple";
    return "unknown";
  }

  function classicCounts(rows) {
    const counts = { single1:0, singleMany:0, multiple:0, unknown:0 };
    rows.forEach(order => {
      const category = effectiveCategory(order);
      if (Object.prototype.hasOwnProperty.call(counts, category)) counts[category]++;
      else counts.unknown++;
    });
    return counts;
  }

  function classicChannelLabel(channel) {
    const key = norm(channel).toLowerCase();
    const labels = { mercado:"Mercado Livre", mercadolivre:"Mercado Livre", shopee:"Shopee", kwai:"Kwai", shein:"Shein", tiktok:"TikTok" };
    return labels[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Outro");
  }

  function classicChannels(rows) {
    const map = new Map();
    rows.forEach(order => {
      const key = norm(order.channel).toLowerCase();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].map(([id,count]) => ({ id, label: classicChannelLabel(id), count }))
      .sort((a,b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  function classicSkuQueue(rows) {
    const map = new Map();
    rows.forEach(order => {
      orderItemsForScan(order).forEach(item => {
        const sku = norm(item.sku);
        if (!sku) return;
        if (!map.has(sku)) map.set(sku,{sku,title:item.title||order.title||"",image:item.image||order.image||"",qty:0,origins:new Set()});
        const row = map.get(sku);
        row.qty += Number(item.qty || 0);
        if (order.sourceName) row.origins.add(order.sourceName);
      });
    });
    const q = fold(skuQueueSearch);
    return [...map.values()]
      .map(row => ({...row,origins:[...row.origins]}))
      .filter(row => !q || fold([row.sku,row.title,...row.origins].join(" ")).includes(q))
      .sort((a,b) => a.sku.localeCompare(b.sku,"pt-BR",{numeric:true,sensitivity:"base"}));
  }

  function ensureClassicCss() {
    if (document.getElementById("kzu-classic-css")) return;
    const style = document.createElement("style");
    style.id = "kzu-classic-css";
    style.textContent =
      "#kzu-root.kzu-classic{background:#f5f5f5;color:#262626;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif}" +
      ".kzu-cl-head{height:68px;background:#fff;border-bottom:1px solid #ededed;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:20}" +
      ".kzu-cl-brand{display:flex;align-items:center;gap:12px}.kzu-cl-logo{width:32px;height:32px;border-radius:7px;background:#000;color:#fff;display:grid;place-items:center;font-weight:900}.kzu-cl-title{font-size:18px;font-weight:700}.kzu-cl-ver{font-size:10px;color:#8c8c8c;margin-top:2px}" +
      ".kzu-cl-pill{display:flex;align-items:center;gap:7px;border:1px solid #d9f7be;background:#f6ffed;color:#389e0d;border-radius:999px;padding:8px 12px;font-size:11px;font-weight:600}.kzu-cl-pill.off{border-color:#ffd8bf;background:#fff7e6;color:#d46b08}.kzu-cl-pill i{width:7px;height:7px;border-radius:50%;background:currentColor}" +
      ".kzu-cl-body{display:grid;grid-template-columns:228px minmax(560px,1fr) 280px;gap:16px;padding:16px 18px 28px;max-width:1800px;margin:0 auto;align-items:start}.kzu-cl-side,.kzu-cl-main,.kzu-cl-right{min-width:0}" +
      ".kzu-cl-card{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;margin-bottom:12px}.kzu-cl-st{font-size:13px;font-weight:700;margin-bottom:12px}.kzu-cl-label{font-size:11px;color:#595959;margin-bottom:6px;display:block}.kzu-cl-select,.kzu-cl-input{width:100%;height:38px;border:1px solid #d9d9d9;border-radius:4px;padding:0 10px;background:#fff;box-sizing:border-box}" +
      ".kzu-cl-sidebtn{width:100%;height:36px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;margin-top:8px;cursor:pointer;font-size:11px;text-align:left;padding:0 10px;display:flex;align-items:center;justify-content:space-between}.kzu-cl-sidebtn.primary{background:#1677ff;border-color:#1677ff;color:#fff;justify-content:center}.kzu-cl-sidebtn:disabled{opacity:.5}" +
      ".kzu-cl-prio{display:grid;grid-template-columns:1fr 1fr;gap:8px}.kzu-cl-prio button{height:34px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;font-size:10px}.kzu-cl-prio button.active{background:#1677ff;border-color:#1677ff;color:#fff}" +
      ".kzu-cl-origin{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0;cursor:pointer}.kzu-cl-origin.off{opacity:.45}.kzu-cl-origin.active b{color:#1677ff}.kzu-cl-origin b{display:block;font-size:11px}.kzu-cl-origin small{font-size:9px;color:#8c8c8c}.kzu-cl-origin em{font-style:normal;font-size:15px;font-weight:700;color:#1677ff}" +
      ".kzu-cl-top{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:20px;margin-bottom:12px}.kzu-cl-eye{font-size:10px;color:#1677ff;font-weight:700}.kzu-cl-h1{font-size:20px;font-weight:700;margin-top:4px}.kzu-cl-sub{font-size:11px;color:#8c8c8c;margin-top:3px}.kzu-cl-scan{display:grid;grid-template-columns:42px 1fr auto;border:2px solid #1677ff;border-radius:5px;height:48px;margin-top:18px;overflow:hidden}.kzu-cl-scan span{display:grid;place-items:center;border-right:1px solid #e6f4ff;color:#1677ff}.kzu-cl-scan input{border:0;outline:0;padding:0 14px;font-size:16px}.kzu-cl-scan b{display:grid;place-items:center;padding:0 14px;font-size:9px;color:#8c8c8c}" +
      ".kzu-cl-msg{margin-top:10px;padding:9px 10px;border-radius:4px;background:#e6f4ff;color:#1677ff;font-size:10px}.kzu-cl-msg.error{background:#fff1f0;color:#cf1322}.kzu-cl-msg.success{background:#f6ffed;color:#389e0d}" +
      ".kzu-cl-market,.kzu-cl-work{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:0 20px;margin-bottom:12px}.kzu-cl-marketbar{display:flex;gap:8px;align-items:center;padding:10px 0;overflow-x:auto}.kzu-cl-marketbar>small{color:#8c8c8c}.kzu-cl-marketbtn{height:38px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;padding:0 12px;font-size:10px}.kzu-cl-marketbtn.active{border-color:#1677ff;color:#1677ff;background:#f0f5ff}.kzu-cl-marketbtn i{font-style:normal;margin-left:4px;background:#f5f5f5;border-radius:9px;padding:2px 5px}" +
      ".kzu-cl-tabs{display:flex;border-bottom:1px solid #f0f0f0}.kzu-cl-tab{position:relative;min-width:190px;border:0;background:transparent;padding:16px 42px 13px 0;text-align:left;color:#595959}.kzu-cl-tab+.kzu-cl-tab{margin-left:26px}.kzu-cl-tab span{display:block;font-size:12px}.kzu-cl-tab small{display:block;font-size:9px;color:#8c8c8c;margin-top:2px}.kzu-cl-tab b{position:absolute;right:4px;top:17px;min-width:22px;height:22px;border-radius:11px;background:#f5f5f5;display:grid;place-items:center;font-size:10px}.kzu-cl-tab.active{color:#1677ff}.kzu-cl-tab.active:after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#1677ff}.kzu-cl-tab.active b{background:#e6f4ff;color:#1677ff}" +
      ".kzu-cl-listhead{padding:16px 0 10px;display:flex;align-items:center;justify-content:space-between}.kzu-cl-listhead strong{font-size:14px}.kzu-cl-list{border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:18px}.kzu-cl-row{display:grid;grid-template-columns:48px minmax(0,1fr) 100px;gap:12px;align-items:center;min-height:68px;padding:10px 12px;border-bottom:1px solid #f0f0f0}.kzu-cl-row:last-child{border-bottom:0}.kzu-cl-row img,.kzu-cl-ph{width:44px;height:44px;object-fit:contain;border:1px solid #eee;border-radius:5px;background:#fafafa}.kzu-cl-rowmain{min-width:0}.kzu-cl-sku{font-size:12px;font-weight:700}.kzu-cl-name{font-size:10px;color:#8c8c8c;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kzu-cl-meta{font-size:9px;color:#8c8c8c;margin-top:4px}.kzu-cl-meta strong{color:#1677ff}.kzu-cl-r{text-align:right}.kzu-cl-r b{font-size:13px}.kzu-cl-r small{display:block;font-size:9px;margin-top:3px}.kzu-cl-r .late{color:#cf1322}.kzu-cl-r .safe{color:#389e0d}" +
      ".kzu-cl-empty{padding:36px;text-align:center;color:#8c8c8c;font-size:11px}.kzu-cl-rightcard{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;position:sticky;top:84px}.kzu-cl-righthead{display:flex;justify-content:space-between;margin-bottom:10px}.kzu-cl-righthead b{font-size:14px}.kzu-cl-righthead small{font-size:9px;color:#1677ff}.kzu-cl-skurow{display:grid;grid-template-columns:38px 1fr auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0}.kzu-cl-skurow img,.kzu-cl-skuph{width:36px;height:36px;object-fit:contain;border:1px solid #eee;border-radius:4px}.kzu-cl-skucopy{min-width:0}.kzu-cl-skucopy b{display:block;font-size:11px}.kzu-cl-skucopy small{display:block;font-size:9px;color:#8c8c8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kzu-cl-skuqty{font-size:14px;font-weight:700;color:#1677ff}" +
      ".kzu-cl-session{border:1px solid #91caff;background:#f0f8ff;border-radius:7px;padding:12px;margin-top:12px}.kzu-cl-sessionhead{display:flex;justify-content:space-between}.kzu-cl-sessionline{display:grid;grid-template-columns:1fr auto;gap:10px;background:#fff;border:1px solid #e8e8e8;border-radius:5px;padding:7px 9px;margin-top:6px;font-size:10px}.kzu-cl-sessionline.done{background:#f6ffed;border-color:#b7eb8f}.kzu-cl-sessionactions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.kzu-cl-sessionactions button{height:34px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;padding:0 12px}.kzu-cl-sessionactions .primary{background:#1677ff;border-color:#1677ff;color:#fff}" +
      "@media(max-width:1150px){.kzu-cl-body{grid-template-columns:210px minmax(0,1fr)}.kzu-cl-right{grid-column:1/-1}.kzu-cl-rightcard{position:relative;top:auto}}@media(max-width:760px){.kzu-cl-body{grid-template-columns:1fr}.kzu-cl-tabs{overflow-x:auto}}";
    document.head.appendChild(style);
  }


  function renderUnifiedFatal(error) {
    if (!isUnifiedPage() || !document.body) return;
    try { injectStyles(); } catch (_) {}
    let root = document.getElementById("kzu-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-root";
      document.body.appendChild(root);
    }
    root.className = "kzu-classic";
    root.innerHTML =
      '<div style="max-width:900px;margin:60px auto;background:#fff;border:1px solid #f3b5b5;border-radius:12px;padding:24px;font-family:Arial,sans-serif">' +
      '<h2 style="margin:0 0 10px;color:#b42318">Checkout Unificado encontrou um erro</h2>' +
      '<div style="font-size:13px;color:#475467;line-height:1.6">A página não será deixada em branco. Erro: <b>' +
      escapeHtml(error && error.message ? error.message : String(error || "desconhecido")) +
      '</b></div><button onclick="location.reload()" style="margin-top:16px;height:38px;padding:0 14px;border:0;border-radius:7px;background:#101828;color:#fff;font-weight:700">Recarregar</button></div>';
  }

  function safeRenderUnified() {
    try { renderUnified(); }
    catch (error) {
      console.error("[Kryzer Unified] erro de render:", error);
      renderUnifiedFatal(error);
    }
  }

  function renderUnified() {
    if (!isUnifiedPage()) return;
    injectStyles();
    ensureClassicCss();

    if (!currentPuid) return;
    if (currentPuid !== MASTER_PUID) {
      blockedPage("Este link é exclusivo do PUID 30945 (MASTER). PUID atual: " + currentPuid + ".");
      return;
    }

    const connected = isUnifiedRelayConnected();
    const sources = sourceSummary();

    if (sourceFilter !== "all") {
      const selectedSource = sources.find(source => String(source.puid) === String(sourceFilter));
      if (!selectedSource || !selectedSource.connected || !(selectedSource.orders || []).length) {
        sourceFilter = "all";
      }
    }

    const clientsOffline = sources.filter(source => source.role === "CLIENT").some(source => !source.connected);
    const baseRows = classicBaseOrders(sources);
    const counts = classicCounts(baseRows);
    const channels = classicChannels(baseRows);
    const categoryRows = baseRows.filter(order => effectiveCategory(order) === categoryFilter);
    const queueRows = classicSkuQueue(baseRows);

    let root = document.getElementById("kzu-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-root";
      document.body.appendChild(root);
    }
    root.className = "kzu-classic";

    const originHtml = sources.map(source => {
      const ageSec = source.updatedAt ? Math.max(0, Math.floor((Date.now() - new Date(source.updatedAt).getTime()) / 1000)) : null;
      const status = source.connected
        ? ((source.transport ? String(source.transport).toUpperCase() + " · " : "") + (ageSec == null ? "conectado" : "há " + ageSec + "s"))
        : "offline";
      return '<div class="kzu-cl-origin ' + (source.connected ? '' : 'off') + (sourceFilter === source.puid ? ' active' : '') + '" data-source="' + escapeHtml(source.puid) + '" title="Clique para filtrar esta origem">' +
        '<div><b>' + escapeHtml(source.name) + '</b><small>PUID ' + escapeHtml(source.puid) + ' · ' + escapeHtml(status) + '</small></div>' +
        '<em>' + Number((source.orders || []).length) + '</em></div>';
    }).join("");

    const channelHtml = [
      '<button class="kzu-cl-marketbtn ' + (channelFilter === "all" ? "active" : "") + '" data-channel="all">Todos <i>' + baseRows.length + '</i></button>',
      ...channels.map(ch => '<button class="kzu-cl-marketbtn ' + (channelFilter === ch.id ? "active" : "") + '" data-channel="' + escapeHtml(ch.id) + '">' + escapeHtml(ch.label) + ' <i>' + ch.count + '</i></button>')
    ].join("");

    const tabHtml = [
      ["single1","Item Único","Quantidade = 1",counts.single1],
      ["singleMany","Item Único","Quantidade > 1",counts.singleMany],
      ["multiple","Múltiplos Itens","Mais de um SKU",counts.multiple]
    ].map(tab =>
      '<button class="kzu-cl-tab ' + (categoryFilter === tab[0] ? "active" : "") + '" data-category="' + tab[0] + '">' +
      '<span>' + tab[1] + '</span><small>' + tab[2] + '</small><b>' + tab[3] + '</b></button>'
    ).join("");

    let listHtml = "";
    if (!categoryRows.length) {
      listHtml = '<div class="kzu-cl-empty">Nenhum pedido nesta categoria.</div>';
    } else if (categoryFilter === "multiple") {
      listHtml = categoryRows.map(order => {
        const items = orderItemsForScan(order);
        const first = items[0] || {};
        const summary = items.map(item => Number(item.qty || 0) + "× " + item.sku).join(" · ");
        const d = classicDeadline(order);
        return '<div class="kzu-cl-row">' +
          (first.image ? '<img src="' + escapeHtml(first.image) + '">' : '<span class="kzu-cl-ph"></span>') +
          '<div class="kzu-cl-rowmain"><div class="kzu-cl-sku">' + escapeHtml(order.orderNo || order.idStr) + '</div>' +
          '<div class="kzu-cl-name">' + escapeHtml(summary || order.title || "Pedido") + '</div>' +
          '<div class="kzu-cl-meta"><strong>' + escapeHtml(order.sourceName || "") + '</strong> · ' + escapeHtml(classicChannelLabel(order.channel)) + ' · ' + escapeHtml(order.shopName || "") + '</div></div>' +
          '<div class="kzu-cl-r"><b>' + items.length + ' SKU</b><small class="' + d.cls + '">' + escapeHtml(d.text) + '</small></div></div>';
      }).join("");
    } else {
      const grouped = new Map();
      categoryRows.forEach(order => {
        const item = orderItemsForScan(order)[0] || {};
        const sku = norm(item.sku || order.sku);
        if (!sku) return;
        if (!grouped.has(sku)) grouped.set(sku,{sku,title:item.title||order.title||"",image:item.image||order.image||"",orders:[],units:0});
        const row = grouped.get(sku);
        row.orders.push(order);
        row.units += Number(order.totalQty || item.qty || 0);
      });
      listHtml = [...grouped.values()].map(row => {
        const sample = row.orders[0] || {};
        const d = classicDeadline(sample);
        const origins = [...new Set(row.orders.map(order => order.sourceName).filter(Boolean))].join(", ");
        return '<div class="kzu-cl-row">' +
          (row.image ? '<img src="' + escapeHtml(row.image) + '">' : '<span class="kzu-cl-ph"></span>') +
          '<div class="kzu-cl-rowmain"><div class="kzu-cl-sku">' + escapeHtml(row.sku) + '</div>' +
          '<div class="kzu-cl-name">' + escapeHtml(row.title || "Produto") + '</div>' +
          '<div class="kzu-cl-meta"><strong>' + escapeHtml(origins) + '</strong> · ' + row.orders.length + ' pedido(s)</div></div>' +
          '<div class="kzu-cl-r"><b>' + Number(row.units || 0) + ' un</b><small class="' + d.cls + '">' + escapeHtml(d.text) + '</small></div></div>';
      }).join("");
    }

    const queueHtml = queueRows.length ? queueRows.map(row =>
      '<div class="kzu-cl-skurow">' +
      (row.image ? '<img src="' + escapeHtml(row.image) + '">' : '<span class="kzu-cl-skuph"></span>') +
      '<div class="kzu-cl-skucopy"><b>' + escapeHtml(row.sku) + '</b><small>' + escapeHtml(row.title || "") + '</small><small>' + escapeHtml(row.origins.join(" · ")) + '</small></div>' +
      '<div class="kzu-cl-skuqty">' + Number(row.qty || 0) + '</div></div>'
    ).join("") : '<div class="kzu-cl-empty">Nenhum SKU.</div>';

    let sessionHtml = "";
    if (checkoutSession) {
      const total = Object.values(checkoutSession.required || {}).reduce((sum,n) => sum + Number(n || 0),0);
      const done = Object.values(checkoutSession.scanned || {}).reduce((sum,n) => sum + Number(n || 0),0);
      const lines = checkoutSession.items.map(item => {
        const read = Number(checkoutSession.scanned[item.sku] || 0);
        const need = Number(checkoutSession.required[item.sku] || 0);
        return '<div class="kzu-cl-sessionline ' + (read >= need ? 'done' : '') + '"><span><b>' + escapeHtml(item.sku) + '</b> · ' + escapeHtml(item.title || "") + '</span><b>' + read + '/' + need + '</b></div>';
      }).join("");
      sessionHtml = '<div class="kzu-cl-session"><div class="kzu-cl-sessionhead"><div><b>Pedido ' + escapeHtml(checkoutSession.orderNo) + ' · ' + escapeHtml(checkoutSession.sourceName) + '</b><div class="kzu-cl-sub">Conferência por bipagem</div></div><b style="color:#1677ff">' + done + '/' + total + '</b></div>' +
        lines +
        '<div class="kzu-cl-sessionactions"><button id="kzu-cancel-session" ' + (checkoutSession.processing ? 'disabled' : '') + '>Cancelar checkout</button>' +
        (checkoutSession.complete ? '<button id="kzu-finish-session" class="primary" ' + (checkoutSession.processing ? 'disabled' : '') + '>' + (checkoutSession.processing ? 'Processando ' + escapeHtml(checkoutSession.stage || '') + '...' : 'Imprimir etiqueta') + '</button>' : '') +
        '</div></div>';
    }

    const msg = lastScanMessage || (baseRows.length ? "Aguardando leitura do próximo SKU..." : "Aguardando os pedidos para checkout...");
    const msgClass = lastScanType === "error" ? " error" : lastScanType === "success" ? " success" : "";
    const listTitle = categoryFilter === "single1" ? "Pedidos de item único" : categoryFilter === "singleMany" ? "Pedidos de item único com quantidade" : "Pedidos com múltiplos itens";

    root.innerHTML =
      '<div class="kzu-cl-head"><div class="kzu-cl-brand"><div class="kzu-cl-logo">K</div><div><div class="kzu-cl-title">Checkout por produto</div><div class="kzu-cl-ver">Kryzer Checkout Unificado · v' + VERSION + '</div></div></div>' +
      '<div class="kzu-cl-pill ' + (connected ? '' : 'off') + '"><i></i>' + (connected ? 'Unificação online' : 'Unificação offline') + '</div></div>' +
      '<div class="kzu-cl-body">' +
        '<aside class="kzu-cl-side">' +
          '<div class="kzu-cl-card"><div class="kzu-cl-st">Unificação</div><label class="kzu-cl-label">Relay dos pedidos</label><select class="kzu-cl-select" disabled><option>' + (connected ? 'Online' : 'Offline') + '</option></select><div class="kzu-cl-sub" style="margin-top:8px">Impressão fica para a próxima etapa.</div></div>' +
          '<div class="kzu-cl-card"><div class="kzu-cl-st">Prioridade</div><div class="kzu-cl-prio"><button id="kzu-today" class="' + (onlyTodayFilter ? 'active' : '') + '">Vence hoje</button><button id="kzu-priority" class="' + (priorityFirstFilter ? 'active' : '') + '">Prazo primeiro</button></div></div>' +
          '<div class="kzu-cl-card"><div class="kzu-cl-st">Origens</div>' + originHtml + '</div>' +
          '<div class="kzu-cl-card"><div class="kzu-cl-st">Ações</div><button id="kzu-refresh" class="kzu-cl-sidebtn primary">Atualizar pedidos</button><button id="kzu-test-bridge" class="kzu-cl-sidebtn">Testar unificação <b>' + (connected ? 'OK' : 'OFF') + '</b></button><button id="kzu-clear-source" class="kzu-cl-sidebtn" ' + (sourceFilter === 'all' ? 'disabled' : '') + '>' + (sourceFilter === 'all' ? 'Todas as origens visíveis' : 'Remover filtro de origem') + '</button><button id="kzu-giro-help" class="kzu-cl-sidebtn">Diagnóstico Giro X <b>' + (sources.find(source => source.puid === "33745")?.connected ? 'OK' : 'OFF') + '</b></button><button class="kzu-cl-sidebtn" disabled>Análise pendente <b>' + counts.unknown + '</b></button></div>' +
        '</aside>' +
        '<main class="kzu-cl-main">' +
          ((!connected || clientsOffline) ? '<div class="kzu-cl-msg error" style="margin:0 0 12px">' +
            (!connected
              ? ('Relay da unificação não respondeu. ' + escapeHtml(cloudRelayLastError || 'Tentando novamente...'))
              : 'Unificação incompleta: alguma origem CLIENT ainda não publicou uma fila recente.') +
            '</div>' : '') +
          '<div class="kzu-cl-top"><div class="kzu-cl-eye">LEITURA RÁPIDA</div><div class="kzu-cl-h1">Escaneie o SKU para iniciar</div><div class="kzu-cl-sub">Os pedidos das contas conectadas são separados em uma única fila e a etiqueta é gerada na conta de origem.</div>' +
          '<div class="kzu-cl-scan"><span>⌁</span><input id="kzu-scanner" autocomplete="off" placeholder="Escanear ou inserir SKU"><b>ENTER</b></div><div class="kzu-cl-msg' + msgClass + '">' + escapeHtml(msg) + '</div>' + sessionHtml + '</div>' +
          '<div class="kzu-cl-market"><div class="kzu-cl-marketbar"><small>Marketplaces</small>' + channelHtml + '</div></div>' +
          '<div class="kzu-cl-work"><div class="kzu-cl-tabs">' + tabHtml + '</div><div class="kzu-cl-listhead"><div><strong>' + listTitle + '</strong><div class="kzu-cl-sub">Origem unificada: MASTER + Moto Cintra + Giro X</div></div><input id="kzu-search" class="kzu-cl-input" style="width:260px" placeholder="Pesquisar pedido, SKU ou produto..." value="' + escapeHtml(searchText) + '"></div><div class="kzu-cl-list">' + listHtml + '</div></div>' +
        '</main>' +
        '<aside class="kzu-cl-right"><div class="kzu-cl-rightcard"><div class="kzu-cl-righthead"><b>SKUs para separar</b><small>Somente esta aba</small></div><input id="kzu-sku-filter" class="kzu-cl-input" placeholder="Filtrar por SKU, nome ou origem" value="' + escapeHtml(skuQueueSearch) + '"><div>' + queueHtml + '</div></div></aside>' +
      '</div>';

    const scanner = root.querySelector("#kzu-scanner");
    if (scanner) {
      scanner.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const value = scanner.value;
        scanner.value = "";
        handleUnifiedScan(value);
      });
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body || document.activeElement === root) scanner.focus();
      }, 20);
    }

    root.querySelector("#kzu-cancel-session")?.addEventListener("click", () => {
      if (checkoutSession?.processing) return;
      checkoutSession = null;
      lastScanMessage = "Separação cancelada.";
      lastScanType = "info";
      safeRenderUnified();
    });
    root.querySelector("#kzu-finish-session")?.addEventListener("click", finalizeUnifiedCheckout);

    root.querySelector("#kzu-search")?.addEventListener("input", event => {
      searchText = event.target.value;
      safeRenderUnified();
      const next = document.getElementById("kzu-search");
      if (next) { next.focus(); next.setSelectionRange(searchText.length, searchText.length); }
    });
    root.querySelector("#kzu-sku-filter")?.addEventListener("input", event => {
      skuQueueSearch = event.target.value;
      safeRenderUnified();
      const next = document.getElementById("kzu-sku-filter");
      if (next) { next.focus(); next.setSelectionRange(skuQueueSearch.length, skuQueueSearch.length); }
    });
    root.querySelectorAll("[data-category]").forEach(button => {
      button.onclick = () => { categoryFilter = button.dataset.category; renderUnified(); };
    });
    root.querySelectorAll("[data-channel]").forEach(button => {
      button.onclick = () => { channelFilter = button.dataset.channel; renderUnified(); };
    });
    root.querySelectorAll("[data-source]").forEach(button => {
      button.onclick = () => {
        sourceFilter = sourceFilter === button.dataset.source ? "all" : button.dataset.source;
        safeRenderUnified();
      };
    });
    root.querySelector("#kzu-today")?.addEventListener("click", () => {
      onlyTodayFilter = !onlyTodayFilter;
      safeRenderUnified();
    });
    root.querySelector("#kzu-priority")?.addEventListener("click", () => {
      priorityFirstFilter = !priorityFirstFilter;
      safeRenderUnified();
    });
    root.querySelector("#kzu-clear-source")?.addEventListener("click", () => {
      sourceFilter = "all";
      safeRenderUnified();
    });
    root.querySelector("#kzu-test-bridge")?.addEventListener("click", async () => {
      await publishSnapshot(true);
      await pollCloudState();
      if (cloudRelayOnline) {
        lastScanMessage = "✓ Relay da unificação conectado.";
        lastScanType = "success";
      } else {
        lastScanMessage = "Relay da unificação não respondeu: " + (cloudRelayLastError || "erro desconhecido");
        lastScanType = "error";
      }
      safeRenderUnified();
    });

    root.querySelector("#kzu-refresh")?.addEventListener("click", async () => {
      await publishSnapshot(true);
      await pollCloudState();
      safeRenderUnified();
    });
    root.querySelector("#kzu-giro-help")?.addEventListener("click", () => {
      window.open("/pt/order/in-process?kzUnifiedSource=1", "_blank");
    });
  }

  async function start() {
    const labelOrderNo = labelTarget();
    if (labelOrderNo) {
      renderLabelCollector();
      startLabelCollectorStandalone(labelOrderNo);
      return;
    }

    try {
      currentPuid = await getCurrentPuid();
    } catch (error) {
      console.warn("[Kryzer Unified] não foi possível identificar PUID:", error);
      if (isUnifiedPage()) blockedPage("Não foi possível identificar a conta UpSeller atual.");
      return;
    }

    currentAccount = ACCOUNTS[currentPuid] || null;
    if (!currentAccount) {
      console.log("[Kryzer Unified] PUID ignorado:", currentPuid);
      if (isUnifiedPage()) blockedPage("Este PUID não faz parte do Checkout Unificado. PUID atual: " + currentPuid + ".");
      return;
    }

    console.log("[Kryzer Unified] conta reconhecida", currentPuid, currentAccount);

    // Mostra a interface imediatamente. A sincronização vem depois.
    if (isUnifiedPage()) {
      injectStyles();
      safeRenderUnified();
    }

    // UNIFICAÇÃO: somente relay em nuvem. Não depende de Kryzer Print.
    await publishSnapshot(true);
    if (currentPuid === MASTER_PUID) await pollCloudState();

    clearInterval(snapshotHeartbeatTimer);
    snapshotHeartbeatTimer = setInterval(() => {
      publishSnapshot(false).catch(() => {});
    }, 10000);

    clearInterval(snapshotRefreshTimer);
    snapshotRefreshTimer = setInterval(() => {
      publishSnapshot(true).catch(() => {});
    }, 30000);

    clearInterval(cloudPollTimer);
    if (currentPuid === MASTER_PUID) {
      cloudPollTimer = setInterval(() => {
        pollCloudState().catch(() => {});
      }, 2000);
    }

    if (isUnifiedPage()) {
      injectStyles();
      safeRenderUnified();
      renderSourcePage();
      setInterval(safeRenderUnified, 10000);
    }
  }

  if (labelTarget() && document.body) {
    try { renderLabelCollector(); } catch (_) {}
  }

  const runStart = () => {
    Promise.resolve(start()).catch(error => {
      console.error("[Kryzer Unified] falha ao iniciar:", error);
      renderUnifiedFatal(error);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runStart, { once: true });
  } else {
    runStart();
  }
}

try {
  initUnifiedCheckoutModule();
} catch (e) {
  console.warn("[Kryzer Agent] erro ao iniciar Checkout Unificado:", e);
}
