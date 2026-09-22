function initUnifiedCheckoutModule() {
  "use strict";

  const VERSION = "0.3.0";
  const WS_URL = "ws://127.0.0.1:21320";
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
  let categoryFilter = "all";
  let sourceFilter = "all";
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
        name: norm(row && (row.warehouseName || row.name || row.title)),
        count: Number(row && (row.cou ?? row.count ?? row.total ?? 0)),
        isDefault: Boolean(row && (row.isDefault === true || Number(row.isDefault) === 1)),
      })).filter(row => row.id);
      warehouseRegistryAt = Date.now();

      const configuredMasterId = norm(currentAccount && currentAccount.masterWarehouseId);
      const masterByName = warehouseRegistry.find(row => fold(row.name) === "MASTER");
      const defaults = warehouseRegistry.filter(row => row.isDefault);
      masterWarehouseId = configuredMasterId ||
        (masterByName ? masterByName.id : "") ||
        (defaults.length === 1 ? defaults[0].id : "");

      console.log("[Kryzer Unified] armazéns", currentPuid, warehouseRegistry, "Master:", masterWarehouseId || "não encontrado", "override:", configuredMasterId || "nenhum");
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

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
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
        }));
      }

      connectionError = "";
      console.log("[Kryzer Unified] snapshot", currentPuid, orders.length, "de", all.length);
      renderUnified();
      renderSourcePage();
    } catch (error) {
      connectionError = error && error.message ? error.message : String(error);
      console.warn("[Kryzer Unified] falha ao sincronizar:", error);
      renderUnified();
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
    return new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Kryzer Print/ponte local está desconectada."));
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
      let result = null;

      if (action === "collect_label") {
        const order = payload.order || {};
        const url = await collectLabelUrl(order);
        result = { url };
      } else if (action === "mark_print") {
        result = await markOrderPrintedRemote(payload.order || {});
        setTimeout(() => publishSnapshot(true), 500);
      } else if (action === "refresh_snapshot") {
        await publishSnapshot(true);
        result = { ok: true };
      } else {
        throw new Error("Ação remota desconhecida: " + action);
      }

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
      socket = new WebSocket(WS_URL);
    } catch (error) {
      connectionError = error && error.message ? error.message : "Falha ao abrir conexão local.";
      renderUnified();
      renderSourcePage();
      scheduleReconnect();
      return;
    }

    const openTimeout = setTimeout(() => {
      if (!socket || socket.readyState === WebSocket.OPEN) return;
      connectionError = "Kryzer Print não respondeu em 4 segundos na porta 21320.";
      try { socket.close(); } catch (_) {}
      renderUnified();
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
      syncTimer = setInterval(() => publishSnapshot(true), 30000);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 15000);
      renderUnified();
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
        renderUnified();
      renderSourcePage();
      }
      if (message.type === "error") {
        connectionError = "Kryzer Print recusou a conexão: " + String(message.error || "erro");
        console.warn("[Kryzer Unified]", message.error);
        renderUnified();
      renderSourcePage();
      }
    });

    socket.addEventListener("close", () => {
      clearTimeout(openTimeout);
      if (!connectionError) connectionError = "Kryzer Print local não está conectado.";
      renderUnified();
      renderSourcePage();
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (!connectionError) connectionError = "Não foi possível conectar em ws://127.0.0.1:21320.";
      renderUnified();
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
      renderUnified();
      return;
    }
    if (checkoutSession && checkoutSession.complete) {
      lastScanMessage = "Finalize ou cancele o pedido " + checkoutSession.orderNo + " antes de iniciar outro.";
      lastScanType = "error";
      renderUnified();
      return;
    }
    const order = findOrderForScan(code);
    if (!order) {
      lastScanMessage = "Nenhum pedido pendente encontrado para " + norm(value) + ".";
      lastScanType = "error";
      renderUnified();
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
      renderUnified();

      await requestLocalPrint(pdfUrl);

      session.stage = "MARK";
      lastScanMessage = "Etiqueta impressa. Atualizando o pedido na conta de origem...";
      renderUnified();

      await requestSourceAction(session.sourcePuid, "mark_print", { order: orderPayload }, 30000);

      lastScanMessage = "✓ " + session.orderNo + " separado e etiqueta impressa com sucesso.";
      lastScanType = "success";
      checkoutSession = null;

      try {
        await requestSourceAction(session.sourcePuid, "refresh_snapshot", {}, 15000);
      } catch (_) {}
      if (session.sourcePuid === MASTER_PUID) publishSnapshot(true).catch(() => {});
      renderUnified();
      setTimeout(() => document.getElementById("kzu-scanner")?.focus(), 80);
    } catch (error) {
      if (checkoutSession) {
        checkoutSession.processing = false;
        checkoutSession.stage = "ERROR";
      }
      lastScanMessage = "Erro em " + session.orderNo + ": " + (error && error.message ? error.message : String(error));
      lastScanType = "error";
      renderUnified();
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

    const connected = socket && socket.readyState === WebSocket.OPEN;
    const bridge = window.KZCheckoutRapido || (typeof unsafeWindow !== "undefined" ? unsafeWindow.KZCheckoutRapido : null);
    const raw = bridge && typeof bridge.snapshotUnificado === "function" ? bridge.snapshotUnificado() : [];
    const filtered = serializeOrders(raw);
    const warehouseText = warehouseRegistry.length
      ? warehouseRegistry.map(row => (row.name || "Sem nome") + " [" + row.id + "]" + (row.isDefault ? " padrão" : "")).join(" · ")
      : "Ainda não foi possível ler os armazéns.";

    root.innerHTML =
      "<div class=\"kzu-head\"><div class=\"kzu-brand\"><div class=\"kzu-logo\">K</div><div><div class=\"kzu-title\">Fonte do Checkout Unificado</div><div class=\"kzu-sub\">" +
      escapeHtml(currentAccount.name) + " · PUID " + escapeHtml(currentPuid) + "</div></div></div>" +
      "<div class=\"kzu-live" + (connected ? " on" : "") + "\"><span class=\"kzu-dot\"></span>" + (connected ? "Conectado ao Kryzer Print" : "Desconectado") + "</div></div>" +
      "<div class=\"kzu-page\"><div class=\"kzu-source client\" style=\"margin-bottom:14px\"><span><strong>" + escapeHtml(currentAccount.name) + "</strong>" +
      "<small>PUID " + escapeHtml(currentPuid) + "</small>" +
      "<div class=\"kzu-diag\"><b>Pedidos brutos:</b> " + raw.length + " · <b>Enviados ao MASTER:</b> " + filtered.length +
      "<br><b>Master ID:</b> " + escapeHtml(masterWarehouseId || "não identificado") +
      "<br>" + escapeHtml(warehouseText) + "</div></span><span class=\"count\">" + filtered.length + "</span></div>" +
      "<div class=\"kzu-toolbar\"><button id=\"kzu-source-refresh\" class=\"kzu-btn active\">Atualizar e reenviar agora</button></div></div>";

    root.querySelector("#kzu-source-refresh")?.addEventListener("click", async () => {
      await loadWarehouseRegistry(true);
      await publishSnapshot(true);
      renderSourcePage();
    });
  }

  function renderUnified() {
    if (!isUnifiedPage()) return;
    injectStyles();

    if (!currentPuid) return;
    if (currentPuid !== MASTER_PUID) {
      blockedPage("Este link é exclusivo do PUID 30945 (MASTER). PUID atual: " + currentPuid + ".");
      return;
    }

    const sources = sourceSummary();
    const orders = filteredOrders();
    const connected = socket && socket.readyState === WebSocket.OPEN;
    const clientSources = sources.filter(source => source.role === "CLIENT");
    const clientsOffline = clientSources.some(source => !source.connected);
    let root = document.getElementById("kzu-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "kzu-root";
      document.body.appendChild(root);
    }

    const sourceCards = sources.map(source => {
      const status = source.connected ? (source.stale ? "Conectado · atualização atrasada" : "Conectado") : "Offline";
      const cls = source.connected ? "" : " off";
      const roleCls = source.role === "MASTER" ? " master" : " client";
      const resolvedMasterId = source.diagnostics && source.diagnostics.masterWarehouseId ? source.diagnostics.masterWarehouseId : "";
      const filterNote = source.role === "CLIENT"
        ? ("Somente armazém Master" + (resolvedMasterId ? " · ID " + resolvedMasterId : ""))
        : "Centralizador";
      const diag = source.diagnostics || null;
      const warehouseText = diag && diag.warehouseCounts
        ? Object.entries(diag.warehouseCounts).map(([name,count]) => name + ": " + count).join(" · ")
        : "";
      const diagHtml = diag
        ? "<div class=\"kzu-diag\"><b>Bruto:</b> " + Number(diag.rawCount || 0) + " · <b>Após filtro:</b> " + Number(diag.filteredCount || 0) +
          (warehouseText ? "<br><span>" + escapeHtml(warehouseText) + "</span>" : "") + "</div>"
        : (source.connected ? "<div class=\"kzu-diag\">Aguardando primeiro diagnóstico...</div>" : "<div class=\"kzu-diag bad\">Perfil/Agent não conectado ao Kryzer Print.</div>");
      return "<button class=\"kzu-source" + cls + roleCls + "\" data-source=\"" + escapeHtml(source.puid) + "\">" +
        "<span><strong>" + escapeHtml(source.name) + "</strong><small>PUID " + escapeHtml(source.puid) + " · " + escapeHtml(status) + "</small><small>" + escapeHtml(filterNote) + "</small>" + diagHtml + "</span>" +
        "<span class=\"count\">" + source.orders.length + "</span></button>";
    }).join("");

    const categoryButtons = [
      ["all", "Todos"],
      ["single1", "Item único = 1"],
      ["singleMany", "Item único > 1"],
      ["multiple", "Múltiplos itens"],
      ["unknown", "Análise pendente"]
    ].map(item => "<button class=\"kzu-btn" + (categoryFilter === item[0] ? " active" : "") + "\" data-category=\"" + item[0] + "\">" + item[1] + "</button>").join("");

    const rows = orders.length ? orders.map(order => {
      const items = order.realItems && order.realItems.length ? order.realItems : order.marketplaceItems || [];
      const first = items[0] || {};
      const skuText = order.sku || (items.length === 1 ? first.sku : items.map(item => item.sku).join(" + "));
      const title = order.title || first.title || "Produto";
      const image = order.image || first.image || "";
      const deadline = deadlineText(order.deadlineAt);
      const late = order.deadlineAt && new Date(order.deadlineAt).getTime() < Date.now();
      return "<div class=\"kzu-row\" data-order-id=\"" + escapeHtml(order.idStr) + "\">" +
        "<div class=\"kzu-origin\">" + escapeHtml(order.sourceName) + "<small>PUID " + escapeHtml(order.sourcePuid) + "</small></div>" +
        "<div><div class=\"kzu-order\">" + escapeHtml(order.orderNo || order.idStr) + "</div><span class=\"kzu-badge\">" + escapeHtml(order.channel || "Canal") + "</span></div>" +
        "<div class=\"kzu-product\">" + (image ? "<img src=\"" + escapeHtml(image) + "\" alt=\"\">" : "<span style=\"width:46px;height:46px;background:#f2f4f7;border-radius:7px\"></span>") +
          "<span><b>" + escapeHtml(skuText || "SKU não identificado") + "</b><small>" + escapeHtml(title) + "</small></span></div>" +
        "<div class=\"kzu-qty\">" + Number(order.totalQty || 0) + "</div>" +
        "<div><b>" + escapeHtml(order.warehouseName || "Sem armazém") + "</b><small style=\"display:block;color:#667085;margin-top:3px\">" + escapeHtml(order.shopName || "") + "</small></div>" +
        "<div class=\"kzu-deadline" + (late ? " late" : "") + "\">" + escapeHtml(deadline) + "</div>" +
      "</div>";
    }).join("") : "<div class=\"kzu-empty\">Nenhum pedido corresponde aos filtros atuais.</div>";

    root.innerHTML =
      "<div class=\"kzu-head\">" +
        "<div class=\"kzu-brand\"><div class=\"kzu-logo\">K</div><div><div class=\"kzu-title\">Checkout Unificado</div><div class=\"kzu-sub\">MASTER 30945 · Moto Cintra 34552 · Giro X 33745</div></div></div>" +
        "<div class=\"kzu-live" + (connected ? " on" : "") + "\"><span class=\"kzu-dot\"></span>" + (connected ? "Kryzer Print conectado" : "Kryzer Print desconectado") + "</div>" +
      "</div>" +
      "<div class=\"kzu-page\">" +
        ((!connected || clientsOffline) ? "<div class=\"kzu-alert\"><span><b>Conexão local incompleta</b><small>" + escapeHtml(connectionError || "O MASTER funciona localmente, mas Giro X e Moto Cintra precisam do Kryzer Print 0.3.0 aberto neste computador.") + "</small></span><button id=\"kzu-open-print\">Abrir Kryzer Print</button></div>" : "") +
        "<div class=\"kzu-sources\">" + sourceCards + "</div>" +
        (checkoutSession ? "<div class=\"kzu-session\"><div class=\"kzu-session-head\"><div><div class=\"kzu-session-title\">Separando " + escapeHtml(checkoutSession.orderNo) + " · " + escapeHtml(checkoutSession.sourceName) + "</div><div class=\"kzu-session-sub\">Leia todos os itens deste pedido antes de finalizar.</div></div><button id=\"kzu-cancel-session\" class=\"kzu-btn\">Cancelar</button></div><div class=\"kzu-session-items\">" +
          checkoutSession.items.map(item => {
            const done = Number(checkoutSession.scanned[item.sku] || 0);
            const need = Number(checkoutSession.required[item.sku] || 0);
            return "<span class=\"kzu-scan-item " + (done >= need ? "done" : "wait") + "\">" + escapeHtml(item.sku) + " · " + done + "/" + need + "</span>";
          }).join("") +
          "</div>" + (lastScanMessage ? "<div class=\"kzu-scan-msg " + escapeHtml(lastScanType) + "\">" + escapeHtml(lastScanMessage) + "</div>" : "") +
          (checkoutSession.complete ? "<div style=\"margin-top:12px\"><button id=\"kzu-finish-session\" class=\"kzu-btn active\" " + (checkoutSession.processing ? "disabled" : "") + ">" + (checkoutSession.processing ? "Processando " + escapeHtml(checkoutSession.stage || "") + "..." : "Pedido conferido · imprimir etiqueta") + "</button></div>" : "") + "</div>" : (lastScanMessage ? "<div class=\"kzu-session\" style=\"border-width:1px\"><div class=\"kzu-scan-msg " + escapeHtml(lastScanType) + "\" style=\"margin:0\">" + escapeHtml(lastScanMessage) + "</div></div>" : "")) +
        "<div class=\"kzu-toolbar\">" +
          "<input id=\"kzu-scanner\" class=\"kzu-scanner\" autocomplete=\"off\" placeholder=\"Bipe SKU / EAN e pressione Enter\">" +
          "<input id=\"kzu-search\" class=\"kzu-search\" autocomplete=\"off\" placeholder=\"Pesquisar pedido, SKU ou produto...\" value=\"" + escapeHtml(searchText) + "\">" +
          categoryButtons +
          "<button id=\"kzu-refresh\" class=\"kzu-btn\">Atualizar agora</button>" +
          (sourceFilter !== "all" ? "<button id=\"kzu-clear-source\" class=\"kzu-btn active\">Fonte: " + escapeHtml(ACCOUNTS[sourceFilter] ? ACCOUNTS[sourceFilter].name : sourceFilter) + " ×</button>" : "") +
        "</div>" +
        "<div class=\"kzu-table\">" +
          "<div class=\"kzu-row head\"><div>Origem</div><div>Pedido</div><div>Produto / SKU</div><div>Qtd.</div><div>Armazém</div><div>Prazo</div></div>" +
          rows +
        "</div>" +
      "</div>";

    const scanner = root.querySelector("#kzu-scanner");
    if (scanner) {
      scanner.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const value = scanner.value;
        scanner.value = "";
        handleUnifiedScan(value);
        setTimeout(() => document.getElementById("kzu-scanner")?.focus(), 20);
      });
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active === root || active.id === "kzu-scanner") scanner.focus();
      }, 30);
    }

    root.querySelector("#kzu-cancel-session")?.addEventListener("click", () => {
      if (checkoutSession?.processing) return;
      checkoutSession = null;
      lastScanMessage = "Separação cancelada.";
      lastScanType = "info";
      renderUnified();
    });
    root.querySelector("#kzu-finish-session")?.addEventListener("click", () => {
      finalizeUnifiedCheckout();
    });

    const search = root.querySelector("#kzu-search");
    if (search) {
      search.addEventListener("input", event => {
        searchText = event.target.value;
        renderUnified();
      renderSourcePage();
        const next = document.getElementById("kzu-search");
        if (next) {
          next.focus();
          next.setSelectionRange(searchText.length, searchText.length);
        }
      });
      // A pesquisa não rouba o foco do leitor. O scanner é o campo operacional padrão.
    }

    root.querySelectorAll("[data-category]").forEach(button => {
      button.onclick = () => { categoryFilter = button.dataset.category; renderUnified(); };
    });
    root.querySelectorAll("[data-source]").forEach(button => {
      button.onclick = () => {
        sourceFilter = sourceFilter === button.dataset.source ? "all" : button.dataset.source;
        renderUnified();
      renderSourcePage();
      };
    });
    root.querySelector("#kzu-clear-source")?.addEventListener("click", () => {
      sourceFilter = "all";
      renderUnified();
      renderSourcePage();
    });
    root.querySelector("#kzu-refresh")?.addEventListener("click", async () => {
      await publishSnapshot(true);
      renderUnified();
      renderSourcePage();
    });
    root.querySelector("#kzu-open-print")?.addEventListener("click", () => {
      try { location.href = "kryzer-print://open"; } catch (_) {}
      setTimeout(connectSocket, 1200);
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
    publishSnapshot(true);
    connectSocket();

    if (isUnifiedPage()) {
      injectStyles();
      renderUnified();
      renderSourcePage();
      setInterval(renderUnified, 10000);
    }
  }

  if (labelTarget() && document.body) {
    try { renderLabelCollector(); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

try {
  initUnifiedCheckoutModule();
} catch (e) {
  console.warn("[Kryzer Agent] erro ao iniciar Checkout Unificado:", e);
}
