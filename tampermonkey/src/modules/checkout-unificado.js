function initUnifiedCheckoutModule() {
  "use strict";

  const VERSION = "0.1.1";
  const WS_URL = "ws://127.0.0.1:21320";
  const MASTER_PUID = "30945";
  const PARAM = "kzUnifiedCheckout";
  const ACCOUNTS = {
    "30945": { name: "MASTER", role: "MASTER", warehouse: "*" },
    "34552": { name: "Moto Cintra", role: "CLIENT", warehouse: "Master" },
    "33745": { name: "Giro X", role: "CLIENT", warehouse: "Master" },
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
  let searchText = "";
  let categoryFilter = "all";
  let sourceFilter = "all";

  const isUnifiedPage = () => new URLSearchParams(location.search).get(PARAM) === "1";
  const norm = value => String(value == null ? "" : value).trim();
  const fold = value => norm(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const escapeHtml = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  async function getCurrentPuid() {
    const response = await fetch("/api/home", { credentials: "include" });
    const json = await response.json();
    return norm(json && json.data && json.data.user && (json.data.user.puid || json.data.user.id));
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

  function allowedWarehouse(order) {
    if (!currentAccount || currentAccount.role !== "CLIENT") return true;
    return fold(order && order.warehouseName) === "MASTER";
  }

  function buildDiagnostics(all, filtered) {
    const warehouseCounts = {};
    (all || []).forEach(order => {
      const name = norm(order && order.warehouseName) || "Sem armazém";
      warehouseCounts[name] = (warehouseCounts[name] || 0) + 1;
    });
    return {
      rawCount: Array.isArray(all) ? all.length : 0,
      filteredCount: Array.isArray(filtered) ? filtered.length : 0,
      warehouseCounts,
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
      warehouseName: norm(order.warehouseName),
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
    } catch (error) {
      connectionError = error && error.message ? error.message : String(error);
      console.warn("[Kryzer Unified] falha ao sincronizar:", error);
      renderUnified();
    } finally {
      syncing = false;
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
      scheduleReconnect();
      return;
    }

    const openTimeout = setTimeout(() => {
      if (!socket || socket.readyState === WebSocket.OPEN) return;
      connectionError = "Kryzer Print não respondeu em 4 segundos na porta 21320.";
      try { socket.close(); } catch (_) {}
      renderUnified();
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
    });

    socket.addEventListener("message", event => {
      let message = null;
      try { message = JSON.parse(String(event.data || "{}")); } catch (_) { return; }
      if (message.type === "unified_state" && currentPuid === MASTER_PUID) {
        lastState = message;
        renderUnified();
      }
      if (message.type === "error") {
        connectionError = "Kryzer Print recusou a conexão: " + String(message.error || "erro");
        console.warn("[Kryzer Unified]", message.error);
        renderUnified();
      }
    });

    socket.addEventListener("close", () => {
      clearTimeout(openTimeout);
      if (!connectionError) connectionError = "Kryzer Print local não está conectado.";
      renderUnified();
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (!connectionError) connectionError = "Não foi possível conectar em ws://127.0.0.1:21320.";
      renderUnified();
    });
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
      ".kzu-search{flex:1;min-width:260px;height:42px;border:1px solid #d0d5dd;border-radius:8px;padding:0 12px;font-size:14px;outline:none}.kzu-search:focus{border-color:#667085}",
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
      const filterNote = source.role === "CLIENT" ? "Somente armazém Master" : "Centralizador";
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
        "<div class=\"kzu-toolbar\">" +
          "<input id=\"kzu-search\" class=\"kzu-search\" autocomplete=\"off\" placeholder=\"Escanear ou pesquisar SKU, pedido, produto...\" value=\"" + escapeHtml(searchText) + "\">" +
          categoryButtons +
          "<button id=\"kzu-refresh\" class=\"kzu-btn\">Atualizar agora</button>" +
          (sourceFilter !== "all" ? "<button id=\"kzu-clear-source\" class=\"kzu-btn active\">Fonte: " + escapeHtml(ACCOUNTS[sourceFilter] ? ACCOUNTS[sourceFilter].name : sourceFilter) + " ×</button>" : "") +
        "</div>" +
        "<div class=\"kzu-table\">" +
          "<div class=\"kzu-row head\"><div>Origem</div><div>Pedido</div><div>Produto / SKU</div><div>Qtd.</div><div>Armazém</div><div>Prazo</div></div>" +
          rows +
        "</div>" +
      "</div>";

    const search = root.querySelector("#kzu-search");
    if (search) {
      search.addEventListener("input", event => {
        searchText = event.target.value;
        renderUnified();
        const next = document.getElementById("kzu-search");
        if (next) {
          next.focus();
          next.setSelectionRange(searchText.length, searchText.length);
        }
      });
      setTimeout(() => {
        if (document.activeElement === document.body || document.activeElement === root) search.focus();
      }, 30);
    }

    root.querySelectorAll("[data-category]").forEach(button => {
      button.onclick = () => { categoryFilter = button.dataset.category; renderUnified(); };
    });
    root.querySelectorAll("[data-source]").forEach(button => {
      button.onclick = () => {
        sourceFilter = sourceFilter === button.dataset.source ? "all" : button.dataset.source;
        renderUnified();
      };
    });
    root.querySelector("#kzu-clear-source")?.addEventListener("click", () => {
      sourceFilter = "all";
      renderUnified();
    });
    root.querySelector("#kzu-refresh")?.addEventListener("click", async () => {
      await publishSnapshot(true);
      renderUnified();
    });
    root.querySelector("#kzu-open-print")?.addEventListener("click", () => {
      try { location.href = "kryzer-print://open"; } catch (_) {}
      setTimeout(connectSocket, 1200);
    });
  }

  async function start() {
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
      setInterval(renderUnified, 10000);
    }
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
