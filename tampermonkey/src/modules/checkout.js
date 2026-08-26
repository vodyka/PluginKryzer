  // =========================================================================
  // MODULE: checkout
  // Ported verbatim from the standalone "UpSeller - Checkout Rápido por SKU"
  // script (~3000 lines, the largest/most complex module) — fullscreen order
  // queue, barcode scanning, abnormal-order handling, and a WebSocket
  // connection to the official UpSeller print plugin (ws://localhost:21319)
  // for real label printing. This is the highest-stakes module (real order
  // fulfillment/printing) — kept 100% verbatim/untouched, mechanically
  // extracted rather than rewritten. Test thoroughly (real print, real
  // checkout) before relying on it for daily operations; this port was
  // structurally verified (syntax, correct extraction boundaries) but not
  // deeply read line-by-line the way compras/alerta_venda were.
  // =========================================================================
function initCheckoutModule() {
  'use strict';

  const VERSION = '0.4.1.0';
  // false = desativa Pedidos anormais; true = ativa novamente.
  const ENABLE_ABNORMAL_ORDERS = false;
  // Preencher com a URL pública da logo real da Kryzer para trocar o "K" azul do
  // cabeçalho por uma imagem. Vazio = mantém o "K" atual.
  const KRYZER_LOGO_URL = 'https://i.ibb.co/1GJRSMbQ/daraa.jpg';
  const PRINT_PLUGIN_URL = 'ws://localhost:21319';
  const FULLSCREEN_MODE = new URLSearchParams(location.search).get('kzCheckout') === '1';
  const ORDERS_ROUTE = '/pt/order/in-process';
  const isOrdersRoute = () => location.pathname === ORDERS_ROUTE;
  const REFRESH_INTERVAL_MS = 60000;
  const AUTO_OPEN_UNPRINTED_TAB = true;

  const STORAGE_UI = 'kz_quick_checkout_ui_v1';
  const STORAGE_PRINTER = 'kz_quick_checkout_printer_v1';
  const STORAGE_PENDING = 'kz_quick_checkout_pending_mark_v1';
  const STORAGE_UNKNOWN_PRINT = 'kz_quick_checkout_unknown_print_v1';
  const STORAGE_STUCK_VOIDED = 'kz_quick_checkout_stuck_voided_v1';
  // Remove o marcador antigo de impressão interrompida, que causava aviso falso e devolvia pedidos já impressos à fila.
  localStorage.removeItem('kz_quick_checkout_print_inflight_v1');
  const STORAGE_FILTERS = 'kz_quick_checkout_filters_v1';
  const STORAGE_LOGS = 'kz_quick_checkout_system_logs_v1';
  const MAX_SYSTEM_LOGS = 500;
  const STORAGE_LAST_PRINTED = 'kz_quick_checkout_last_printed_v1';
  const STORAGE_PRINT_HISTORY = 'kz_quick_checkout_print_history_v1';
  const STORAGE_ABNORMAL = 'kz_quick_checkout_abnormal_v1';
  const STORAGE_ABNORMAL_REASONS = 'kz_quick_checkout_abnormal_reasons_v1';
  const STORAGE_SKU_FILTERS = 'kz_quick_checkout_sku_filters_v1';
  const STORAGE_WAREHOUSE_ALIASES = 'kz_quick_checkout_warehouse_aliases_v1';
const STORAGE_BULK_MASS_PRINT = 'kz_quick_checkout_bulk_mass_v1';
const STORAGE_QTY_SCAN_CONFIRM = 'kz_quick_checkout_qty_scan_confirm_v1';
const STORAGE_STOCK_SHORTAGES = 'kz_quick_checkout_stock_shortages_v1';

  const CHANNELS = [
    { id: 'shopee', label: 'Shopee' },
    { id: 'mercado', label: 'Mercado Livre' },
    { id: 'shein', label: 'Shein' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'kwai', label: 'Kwai' },
  ];

  const CHANNEL_LOGOS = {
    shopee: `<span class="kzqc-market-logo shopee" aria-label="shopee"><img src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20160%2044%22%3E%3Cpath%20fill%3D%22%23EE4D2D%22%20d%3D%22M10%2013h30l2.5%2025H7.5L10%2013Zm7%200C17%205%2021%201%2025%201s8%204%208%2012h-4c0-5-1.8-8-4-8s-4%203-4%208h-4Z%22/%3E%3Ctext%20x%3D%2250%22%20y%3D%2231%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2225%22%20font-weight%3D%22700%22%20fill%3D%22%23EE4D2D%22%3EShopee%3C/text%3E%3C/svg%3E" alt="shopee"></span>`,
    mercado: `<span class="kzqc-market-logo mercado" aria-label="mercado"><img src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20190%2034%22%3E%3Ctext%20x%3D%220%22%20y%3D%2226%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2226%22%20font-weight%3D%22800%22%20fill%3D%22%232D3277%22%3Emercado%20livre%3C/text%3E%3C/svg%3E" alt="mercado"></span>`,
    shein: `<span class="kzqc-market-logo shein" aria-label="shein"><img src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20120%2030%22%3E%3Ctext%20x%3D%2260%22%20y%3D%2223%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2225%22%20font-weight%3D%22700%22%20letter-spacing%3D%222%22%20fill%3D%22%23222%22%3ESHEIN%3C/text%3E%3C/svg%3E" alt="shein"></span>`,
    tiktok: `<span class="kzqc-market-logo tiktok" aria-label="tiktok"><img src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20160%2036%22%3E%3Cpath%20d%3D%22M18%205v17a7%207%200%201%201-5-6.7%22%20fill%3D%22none%22%20stroke%3D%22%23111%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22/%3E%3Cpath%20d%3D%22M18%205c2%205%205%207%2010%207%22%20fill%3D%22none%22%20stroke%3D%22%2325F4EE%22%20stroke-width%3D%223%22/%3E%3Cpath%20d%3D%22M16%204c2%205%205%207%2010%207%22%20fill%3D%22none%22%20stroke%3D%22%23FF2751%22%20stroke-width%3D%223%22/%3E%3Ctext%20x%3D%2288%22%20y%3D%2225%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2221%22%20font-weight%3D%22700%22%20fill%3D%22%23111%22%3ETikTok%20Shop%3C/text%3E%3C/svg%3E" alt="tiktok"></span>`,
    kwai: `<span class="kzqc-market-logo kwai" aria-label="kwai"><img src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20140%2034%22%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%23FF4906%22%20stroke-width%3D%223%22%3E%3Ccircle%20cx%3D%2216%22%20cy%3D%2210%22%20r%3D%227%22/%3E%3Ccircle%20cx%3D%2231%22%20cy%3D%2210%22%20r%3D%225%22/%3E%3Cpath%20d%3D%22M8%2019h25a6%206%200%200%201%206%206v5H14a6%206%200%200%201-6-6v-5Z%22/%3E%3C/g%3E%3Ctext%20x%3D%2286%22%20y%3D%2225%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2223%22%20font-weight%3D%22700%22%20fill%3D%22%232D2D2D%22%3EKwai%3C/text%3E%3C/svg%3E" alt="kwai"></span>`,
  };

  function channelButtonContent(channel) {
    return CHANNEL_LOGOS[channel.id] || `<span class="kzqc-channel-text">${escapeHtml(channel.label)}</span>`;
  }

  function switchToggleHtml(id, checked, label, title = '') {
    return `<label class="kzqc-switch-row" title="${escapeHtml(title)}"><span>${escapeHtml(label)}</span><label class="kzqc-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="kzqc-slider"></span></label></label>`;
  }

  const state = {
    orders: [],
    rawCount: 0,
    lastCaptureAt: '',
    agentOnline: false,
    printers: [],
    printer: localStorage.getItem(STORAGE_PRINTER) || '',
    loading: false,
    refreshing: false,
    minimized: readJson(STORAGE_UI, { minimized: false }).minimized === true,
    activeTab: readJson(STORAGE_UI, { activeTab: 'single1' }).activeTab || 'single1',
    checkoutSession: null,
    message: 'Aguardando os pedidos para checkout...',
    messageType: 'info',
    pending: readJson(STORAGE_PENDING, null),
    unknownPrint: readJson(STORAGE_UNKNOWN_PRINT, null),
    stuckVoidedOrders: readJson(STORAGE_STUCK_VOIDED, []),
    filters: readJson(STORAGE_FILTERS, { channelSelection: {}, onlyToday: false, priorityFirst: true }),
    systemLogs: readJson(STORAGE_LOGS, []),
    lastPrinted: readJson(STORAGE_LAST_PRINTED, null),
    printHistory: readJson(STORAGE_PRINT_HISTORY, []),
    analysisFailures: 0,
    pluginPuid: 0,
    pluginStatus: 'desconectado',
    activePrintJob: null,
    abnormalIds: readJson(STORAGE_ABNORMAL, []),
    abnormalReasons: readJson(STORAGE_ABNORMAL_REASONS, {}),
    skuFilters: readJson(STORAGE_SKU_FILTERS, { query: '', warehouses: [], currentTabOnly: true }),
    expandedMultipleId: '',
    warehouseAliases: readJson(STORAGE_WAREHOUSE_ALIASES, {}),
bulkMassPrintEnabled: readJson(STORAGE_BULK_MASS_PRINT, true) !== false,
qtyScanConfirmEnabled: readJson(STORAGE_QTY_SCAN_CONFIRM, false) === true,
stockShortages: readJson(STORAGE_STOCK_SHORTAGES, {}),
  };

  let bridgeInstalled = false;
  let refreshTimer = null;
  let agentTimer = null;
  let pluginSocket = null;
  let pluginConnectPromise = null;
  let pluginReconnectTimer = null;
  let renderTimer = null;
  let refreshSequence = 0;
  let lastOrdersFingerprint = '';
  let countdownTimer = null;
  const skuDetailCache = new Map();

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function norm(value) {
    return String(value == null ? '' : value).trim();
  }

  function normSku(value) {
    return norm(value).toUpperCase().replace(/\s+/g, '');
  }

  function foldText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function wildcardMatches(value, pattern) {
    const text = foldText(value);
    const raw = foldText(pattern).trim();
    if (!raw) return true;
    const escaped = raw.split('%').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    try { return new RegExp(escaped).test(text); } catch { return text.includes(raw.replace(/%/g, '')); }
  }


  function normalizeScanCode(value) {
    return norm(value).toUpperCase().replace(/[\s-]+/g, '');
  }

  // Appends brand + first SKU alias to the display title when available,
  // e.g. "ESTICADO TENSOR - VS250" -> "ESTICADO TENSOR - VS250 - VCJ - VS250".
  // Accepts either an order (pulls from its first realItem) or an item
  // directly (kit component rows already pass the item itself).
  function skuAliasText(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (typeof value === "object") return String(value.alias || value.value || value.code || value.name || value.sku || "").trim();
    return "";
  }

  function displaySkuAlias(item) {
    const aliases = Array.isArray(item?.skuAliasList) ? item.skuAliasList.map(skuAliasText).filter(Boolean) : [];
    // O alias mais recente/real costuma ser o último cadastrado no UpSeller.
    // Evita repetir exatamente o SKU ou um trecho já presente no título.
    const titleFold = foldText(item?.title || '');
    const skuFold = foldText(item?.sku || '');
    return [...aliases].reverse().find(alias => {
      const folded = foldText(alias);
      return folded && folded !== skuFold && !titleFold.includes(folded);
    }) || aliases.at(-1) || '';
  }

  function enrichedTitleParts(entity) {
    const item = entity?.realItems?.[0] || entity || {};
    return {
      title: entity?.title || item?.title || 'Produto sem título',
      brand: item?.brand || entity?.brand || '',
      alias: displaySkuAlias(item),
    };
  }

  function enrichedTitle(entity) {
    const parts = enrichedTitleParts(entity);
    return [parts.title, parts.brand, parts.alias].filter(Boolean).join(' - ');
  }

  function enrichedTitleHtml(entity) {
    const parts = enrichedTitleParts(entity);
    return `<span>${escapeHtml(parts.title)}</span>${parts.brand?` <span class="kzqc-product-brand">- ${escapeHtml(parts.brand)}</span>`:''}${parts.alias?` <span class="kzqc-product-alias">- ${escapeHtml(parts.alias)}</span>`:''}`;
  }

  function collectBarcodeCandidates(item) {
    const found = new Set();
    const seen = new Set();
    const keyPattern = /(barcode|bar.?code|gtin|ean|upc|codigo.?de.?barras|c[oó]digo.?barras)/i;

    function add(value) {
      if (Array.isArray(value)) { value.forEach(add); return; }
      if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return;
      // O UpSeller pode devolver vários códigos no mesmo campo, separados por vírgula.
      // Ex.: "4005108986467,7892166017625".
      String(value).split(/[,;|\s]+/).forEach(part => {
        const code = normalizeScanCode(part);
        if (code && code.length >= 4) found.add(code);
      });
    }

    function walk(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        if (keyPattern.test(key)) add(value);
        if (value && typeof value === 'object') walk(value, depth + 1);
      }
    }

    add(item?.gtinCode); add(item?.barcode); add(item?.barCode); add(item?.ean); add(item?.upc);
    walk(item);
    return [...found];
  }

  function inventoryBarcodeMap() {
    const map = new Map();
    const keys = ['ups_v3_estoque_raw', 'kz_inventory_raw', 'ups_inventory_raw'];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const json = JSON.parse(raw);
        const list = json?.data?.list || json?.data?.records || json?.list || [];
        if (!Array.isArray(list)) continue;
        for (const row of list) {
          const sku = normSku(row?.sku || row?.warehouseSku || row?.skuCode);
          if (!sku) continue;
          const codes = collectBarcodeCandidates(row);
          if (!map.has(sku)) map.set(sku, new Set());
          codes.forEach(code => map.get(sku).add(code));
        }
      } catch (error) {
        console.warn('[KZ Checkout] falha ao ler mapa local de códigos de barras', key, error);
      }
    }
    return map;
  }

  function mergeScanAliases(sku, ...lists) {
    const aliases = new Set([normalizeScanCode(sku)]);
    lists.flat(Infinity).forEach(value => {
      const code = normalizeScanCode(value);
      if (code) aliases.add(code);
    });
    const inv = inventoryBarcodeMap().get(normSku(sku));
    inv?.forEach(code => aliases.add(code));
    return [...aliases].filter(Boolean);
  }

  // "Sem estoque" manual: o operador digita -SKU*QTD (ex.: -14947*3) no campo de
  // bipagem pra avisar que QTD unidades daquele SKU não existem fisicamente. Isso
  // reduz quanto o app oferece pra imprimir em massa no Item Único (=1) e sinaliza
  // nos cards de Item Único (>1) e Múltiplos Itens que aquele pedido não vai sair.
  function shortageQtyFor(sku) {
    return Math.max(0, Number(state.stockShortages?.[normSku(sku)] || 0));
  }
  function saveStockShortages() { saveJson(STORAGE_STOCK_SHORTAGES, state.stockShortages || {}); }
  function setStockShortage(sku, qty) {
    const key = normSku(sku);
    if (!key) return;
    if (qty <= 0) delete state.stockShortages[key];
    else state.stockShortages[key] = qty;
    saveStockShortages();
  }
  function addStockShortage(sku, qty) {
    setStockShortage(sku, shortageQtyFor(sku) + Math.max(0, Number(qty) || 0));
  }
  function clearStockShortage(sku) { setStockShortage(sku, 0); scheduleRender(); }

  function itemMatchesScan(item, value) {
    const code = normalizeScanCode(value);
    if (!code) return false;
    return mergeScanAliases(item?.sku, item?.scanAliases || item?.barcodes || []).includes(code);
  }


  // Cache dinâmico: código de barras/GTIN/EAN -> SKU físico.
  // Alguns pedidos não trazem o código de barras em /api/order/index nem em
  // /api/sku-order/detail. Nesses casos consultamos o cadastro de estoque sob demanda.
  const dynamicBarcodeSkuMap = new Map();
  const barcodeLookupInFlight = new Map();

  function rememberBarcodeSku(code, sku) {
    const normalizedCode = normalizeScanCode(code);
    const normalizedSku = normSku(sku);
    if (!normalizedCode || !normalizedSku) return;
    dynamicBarcodeSkuMap.set(normalizedCode, normalizedSku);
  }

  function findSkuInPayloadByBarcode(payload, scannedCode) {
    const target = normalizeScanCode(scannedCode);
    if (!target) return '';
    const seen = new Set();
    let result = '';

    function walk(node, inheritedSku = '', depth = 0) {
      if (result || !node || typeof node !== 'object' || depth > 10 || seen.has(node)) return;
      seen.add(node);

      const currentSku = normSku(
        node?.varSku || node?.warehouseSku || node?.sku || node?.skuCode ||
        node?.productSku || node?.variationSku || inheritedSku
      );
      const codes = collectBarcodeCandidates(node);
      if (currentSku && codes.includes(target)) {
        result = currentSku;
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(item => walk(item, currentSku || inheritedSku, depth + 1));
      } else {
        Object.values(node).forEach(value => {
          if (value && typeof value === 'object') walk(value, currentSku || inheritedSku, depth + 1);
        });
      }
    }

    walk(payload);
    return result;
  }

  async function fetchBarcodeSkuFromUpseller(scannedCode) {
    const target = normalizeScanCode(scannedCode);
    if (!target) return '';

    const warehouseIds = [...new Set((state.orders || []).map(order =>
      norm(order?.warehouseIdStr || order?.warehouseId)
    ).filter(Boolean))];

    const basePayloads = [
      { searchValue: target, searchType: 'sku', pageNum: '1', pageSize: '100', warehouseType: '0' },
      { searchValue: target, searchType: 'barcode', pageNum: '1', pageSize: '100', warehouseType: '0' },
      { keyword: target, pageNum: '1', pageSize: '100', warehouseType: '0' },
      { sku: target, pageNum: '1', pageSize: '100', warehouseType: '0' },
      { gtinCode: target, pageNum: '1', pageSize: '100', warehouseType: '0' },
      { barcode: target, pageNum: '1', pageSize: '100', warehouseType: '0' },
    ];

    const endpoints = [
      '/api/inventory/list',
      '/api/warehouse-sku/list',
      '/api/inventory/warehouse-sku/list',
    ];

    for (const endpoint of endpoints) {
      for (const warehouseId of [...warehouseIds, '']) {
        for (const payload of basePayloads) {
          const data = { ...payload };
          if (warehouseId) {
            data.warehouseId = warehouseId;
            data.warehouseIdStr = warehouseId;
          }
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-requested-with': 'XMLHttpRequest',
              },
              body: new URLSearchParams(data).toString(),
            });
            if (!response.ok) continue;
            const json = await response.json().catch(() => null);
            if (!json) continue;
            const sku = findSkuInPayloadByBarcode(json, target);
            if (sku) return sku;
          } catch (_) {}
        }
      }
    }
    return '';
  }

  async function resolveScanToSku(value) {
    const code = normalizeScanCode(value);
    if (!code) return '';

    // Se já é um SKU presente na fila, não consulta a rede.
    const currentItems = (state.orders || []).flatMap(order => order?.realItems || []);
    const direct = currentItems.find(item => normSku(item?.sku) === normSku(code));
    if (direct?.sku) return normSku(direct.sku);

    // Aliases já conhecidos no pedido/localStorage.
    const aliasHit = currentItems.find(item => itemMatchesScan(item, code));
    if (aliasHit?.sku) {
      rememberBarcodeSku(code, aliasHit.sku);
      return normSku(aliasHit.sku);
    }

    if (dynamicBarcodeSkuMap.has(code)) return dynamicBarcodeSkuMap.get(code);
    if (barcodeLookupInFlight.has(code)) return barcodeLookupInFlight.get(code);

    const promise = (async () => {
      const sku = await fetchBarcodeSkuFromUpseller(code);
      if (sku) rememberBarcodeSku(code, sku);
      return sku || code;
    })().finally(() => barcodeLookupInFlight.delete(code));

    barcodeLookupInFlight.set(code, promise);
    return promise;
  }


  // skuAliasList não vem em /api/sku/scan-sku — só existe no cadastro completo do
  // produto, retornado por /api/sku/index-single (o mesmo endpoint usado pela busca
  // de produtos e pelo módulo canva_sync). Busca o catálogo inteiro paginado (mesma
  // forma já confirmada funcionando em initCanvaSyncModule) e cacheia por SKU, em vez
  // de tentar adivinhar o parâmetro de busca por SKU único desse endpoint.
  let indexSingleMapCache = null;
  let indexSingleMapCacheAt = 0;
  let indexSingleMapPromise = null;
  const INDEX_SINGLE_CACHE_TTL_MS = 15 * 60 * 1000;

  async function fetchAllProductsIndexSingle() {
    const all = [];
    const pageSize = 300;
    let pageNum = 1;
    for (;;) {
      const res = await fetch('/api/sku/index-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pageNum, pageSize, sortName: '0', sortValue: '0', searchGroup: 1 }),
      });
      if (!res.ok) throw new Error(`index-single HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.msg || 'index-single falhou');
      const data = json.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      all.push(...list);
      const total = Number(data.total || 0);
      if (!list.length || pageNum * pageSize >= total) break;
      pageNum++;
    }
    return all;
  }

  async function getIndexSingleMap() {
    const now = Date.now();
    if (indexSingleMapCache && (now - indexSingleMapCacheAt) < INDEX_SINGLE_CACHE_TTL_MS) return indexSingleMapCache;
    if (indexSingleMapPromise) return indexSingleMapPromise;
    indexSingleMapPromise = (async () => {
      try {
        const products = await fetchAllProductsIndexSingle();
        const map = new Map();
        const addEntry = (sku, aliasList, brand) => {
          const key = normSku(sku);
          if (!key || map.has(key)) return;
          map.set(key, { skuAliasList: Array.isArray(aliasList) ? aliasList : [], brand: norm(brand) });
        };
        for (const item of products) {
          addEntry(item?.sku, item?.skuAliasList, item?.brand);
          // Kits: cada componente é um SKU físico próprio, com seu próprio alias/marca.
          if (Array.isArray(item?.groupVOS)) {
            for (const comp of item.groupVOS) addEntry(comp?.varSku || comp?.sku, comp?.skuAliasList, comp?.brand);
          }
        }
        indexSingleMapCache = map;
        indexSingleMapCacheAt = Date.now();
        return map;
      } catch (error) {
        console.warn('[KZ Checkout] falha ao buscar index-single para skuAliasList', error);
        return indexSingleMapCache || new Map();
      } finally {
        indexSingleMapPromise = null;
      }
    })();
    return indexSingleMapPromise;
  }

  // Enriquece os itens com barcode/GTIN diretamente do cadastro de SKU do UpSeller.
  // O checkout oficial faz exatamente esta consulta para cada SKU físico:
  // GET /api/sku/scan-sku?searchType=1&searchValue=SKU&sourceType=2&warehouseId=...
  const skuScanInfoCache = new Map();
  const skuScanInfoInFlight = new Map();

  async function fetchSkuScanInfo(sku, warehouseId) {
    const normalizedSku = normSku(sku);
    const wh = norm(warehouseId);
    if (!normalizedSku || !wh) return null;
    const key = `${wh}::${normalizedSku}`;
    if (skuScanInfoCache.has(key)) return skuScanInfoCache.get(key);
    if (skuScanInfoInFlight.has(key)) return skuScanInfoInFlight.get(key);

    const promise = (async () => {
      try {
        const url = '/api/sku/scan-sku?' + new URLSearchParams({
          searchType: '1',
          searchValue: normalizedSku,
          sourceType: '2',
          warehouseId: wh,
        }).toString();
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
          },
        });
        if (!response.ok) return null;
        const json = await response.json().catch(() => null);
        const data = json?.data || null;
        if (!data || normSku(data?.sku) !== normalizedSku) return null;
        let aliasListRaw = data?.skuAliasList ?? data?.aliasList ?? data?.skuAlias ?? data?.supplierAliasList ?? [];
        // Alguns campos dessa API (ex.: variantsAttr) vêm como string JSON em vez de
        // array/objeto direto — tenta decodificar antes de desistir.
        if (typeof aliasListRaw === 'string') {
          const trimmed = aliasListRaw.trim();
          if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try { aliasListRaw = JSON.parse(trimmed); } catch {}
          }
        }
        const info = {
          sku: normalizedSku,
          idStr: norm(data?.idStr || data?.id),
          barcode: norm(data?.barcode),
          gtinCode: norm(data?.gtinCode),
          skuAliasList: Array.isArray(aliasListRaw) ? aliasListRaw : (aliasListRaw ? [aliasListRaw] : []),
          brand: norm(data?.brand),
          aliases: collectBarcodeCandidates(data),
        };
        if (!info.skuAliasList.length) console.debug('[KZ Checkout] scan-sku sem skuAliasList', normalizedSku, data);
        skuScanInfoCache.set(key, info);
        return info;
      } catch (error) {
        console.warn('[KZ Checkout] falha ao consultar código de barras do SKU', normalizedSku, error);
        return null;
      }
    })().finally(() => skuScanInfoInFlight.delete(key));

    skuScanInfoInFlight.set(key, promise);
    return promise;
  }

  const skuDetailInfoCache = new Map();
  const skuDetailInfoInFlight = new Map();

  async function fetchSkuDetailInfo(idStr, sku) {
    const key = norm(idStr) || normSku(sku);
    if (!key) return null;
    if (skuDetailInfoCache.has(key)) return skuDetailInfoCache.get(key);
    if (skuDetailInfoInFlight.has(key)) return skuDetailInfoInFlight.get(key);

    const promise = (async () => {
      const payloads = [];
      if (idStr) payloads.push({ idStr: String(idStr) }, { id: String(idStr) });
      if (sku) payloads.push({ sku: String(sku) });
      for (const payload of payloads) {
        try {
          const response = await fetch('/api/sku/detail-single', {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
            body: JSON.stringify(payload),
          });
          if (!response.ok) continue;
          const json = await response.json().catch(() => null);
          const data = json?.data || null;
          if (!data || !isSuccess(json)) continue;
          const info = {
            sku: normSku(data?.sku || sku),
            title: norm(data?.title),
            brand: norm(data?.brand),
            skuAliasList: Array.isArray(data?.skuAliasList) ? data.skuAliasList : [],
            barcode: norm(data?.barcode),
            gtinCode: norm(data?.gtinCode),
          };
          skuDetailInfoCache.set(key, info);
          if (info.sku) skuDetailInfoCache.set(info.sku, info);
          return info;
        } catch (_) {}
      }
      return null;
    })().finally(() => skuDetailInfoInFlight.delete(key));

    skuDetailInfoInFlight.set(key, promise);
    return promise;
  }

  async function enrichOrdersWithSkuScanInfo(orders) {
    const tasks = [];
    for (const order of orders || []) {
      const warehouseId = norm(order?.warehouseId || order?.raw?.warehouseIdStr || order?.raw?.warehouseId);
      if (!warehouseId) continue;
      for (const item of order?.realItems || []) {
        const sku = normSku(item?.sku);
        if (!sku) continue;
        tasks.push({ order, item, sku, warehouseId });
      }
    }

    const unique = new Map();
    tasks.forEach(task => unique.set(`${task.warehouseId}::${task.sku}`, task));
    const infoMap = new Map();
    await mapWithConcurrency([...unique.values()], 8, async task => {
      const info = await fetchSkuScanInfo(task.sku, task.warehouseId);
      if (info) infoMap.set(`${task.warehouseId}::${task.sku}`, info);
      return info;
    });

    const indexMap = await getIndexSingleMap();
    const detailMap = new Map();
    await mapWithConcurrency([...unique.values()], 6, async task => {
      const info = infoMap.get(`${task.warehouseId}::${task.sku}`);
      const detail = await fetchSkuDetailInfo(info?.idStr, task.sku);
      if (detail) detailMap.set(task.sku, detail);
      return detail;
    });

    for (const task of tasks) {
      const info = infoMap.get(`${task.warehouseId}::${task.sku}`);
      const indexInfo = indexMap.get(task.sku);
      const detailInfo = detailMap.get(task.sku);
      if (!info && !indexInfo && !detailInfo) continue;
      task.item.title = detailInfo?.title || task.item.title || '';
      task.item.barcode = detailInfo?.barcode || info?.barcode || task.item.barcode || '';
      task.item.brand = detailInfo?.brand || info?.brand || indexInfo?.brand || task.item.brand || '';
      // skuAliasList confirmado em /api/sku/detail-single.
      task.item.skuAliasList = detailInfo?.skuAliasList?.length ? detailInfo.skuAliasList : ((indexInfo?.skuAliasList?.length) ? indexInfo.skuAliasList : ((info?.skuAliasList?.length) ? info.skuAliasList : (task.item.skuAliasList || [])));
      task.item.gtinCode = detailInfo?.gtinCode || info?.gtinCode || task.item.gtinCode || '';
      task.item.scanAliases = mergeScanAliases(
        task.item.sku,
        task.item.scanAliases || [],
        info?.aliases || [],
        task.item.skuAliasList || [],
        info?.barcode,
        info?.gtinCode
      );
      for (const alias of task.item.scanAliases) rememberBarcodeSku(alias, task.item.sku);
    }
    return orders;
  }

  function numberValue(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function escapeHtml(value) {
    return norm(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[ch]);
  }

  function isSuccess(json) {
    if (!json || typeof json !== 'object') return false;
    const code = json.code ?? json.status ?? json.data?.code;
    return code === 0 || code === 200 || code === '0' || code === '200' ||
      json.success === true || json.ok === true || json.msg === 'success' || json.message === 'success';
  }

  function setMessage(message, type = 'info') {
    state.message = message;
    state.messageType = type;
    scheduleRender();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, 30);
  }

  function installPageBridge() {
    if (bridgeInstalled) return;
    bridgeInstalled = true;

    const code = `(() => {
      if (window.__KZ_QUICK_CHECKOUT_BRIDGE__) return;
      window.__KZ_QUICK_CHECKOUT_BRIDGE__ = true;

      const originalFetch = window.fetch.bind(window);
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      let lastReplay = null;

      function emit(type, payload) {
        window.postMessage({
          source: 'KZ_QUICK_CHECKOUT_BRIDGE',
          type,
          payload: JSON.stringify(payload || {})
        }, '*');
      }

      async function parseAndEmit(url, response, origin) {
        if (!String(url || '').includes('/api/order/index')) return;
        try {
          const clone = response.clone();
          const text = await clone.text();
          const json = JSON.parse(text);
          emit('ORDER_INDEX_RESPONSE', { url: String(url), json, origin, at: Date.now() });
        } catch (error) {
          emit('BRIDGE_ERROR', { where: 'parseAndEmit', error: String(error) });
        }
      }

      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';

        if (String(url).includes('/api/order/index')) {
          try {
            if (input instanceof Request) {
              const savedRequest = input.clone();
              lastReplay = async () => {
                const response = await originalFetch(savedRequest.clone(), init);
                await parseAndEmit(url, response, 'replay-fetch-request');
              };
            } else {
              const savedInit = init ? { ...init } : undefined;
              lastReplay = async () => {
                const response = await originalFetch(input, savedInit);
                await parseAndEmit(url, response, 'replay-fetch');
              };
            }
          } catch (error) {
            emit('BRIDGE_ERROR', { where: 'save-fetch', error: String(error) });
          }
        }

        const response = await originalFetch(input, init);
        parseAndEmit(url, response, 'page-fetch');
        return response;
      };

      XMLHttpRequest.prototype.open = function(method, url) {
        this.__kzMethod = method;
        this.__kzUrl = url;
        this.__kzHeaders = {};
        return originalOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this.__kzHeaders) this.__kzHeaders[name] = value;
        return originalSetHeader.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        const url = this.__kzUrl || '';
        if (String(url).includes('/api/order/index')) {
          const method = this.__kzMethod || 'POST';
          const headers = { ...(this.__kzHeaders || {}) };
          const savedBody = typeof body === 'string' || body == null ? body : null;
          lastReplay = async () => {
            const response = await originalFetch(url, {
              method,
              headers,
              credentials: 'include',
              body: savedBody
            });
            await parseAndEmit(url, response, 'replay-xhr');
          };
        }

        this.addEventListener('load', function() {
          if (!String(url).includes('/api/order/index')) return;
          try {
            const json = JSON.parse(this.responseText);
            emit('ORDER_INDEX_RESPONSE', { url: String(url), json, origin: 'page-xhr', at: Date.now() });
          } catch (error) {
            emit('BRIDGE_ERROR', { where: 'xhr-load', error: String(error) });
          }
        });
        return originalSend.apply(this, arguments);
      };

      window.addEventListener('message', async event => {
        const data = event.data || {};
        if (data.source !== 'KZ_QUICK_CHECKOUT_SCRIPT') return;
        if (data.type === 'REFRESH_ORDER_INDEX') {
          if (!lastReplay) {
            emit('NO_REPLAY_REQUEST', {});
            return;
          }
          try {
            await lastReplay();
          } catch (error) {
            emit('BRIDGE_ERROR', { where: 'replay', error: String(error) });
          }
        }
      });

      emit('BRIDGE_READY', { version: '${VERSION}' });
    })();`;

    const inject = () => {
      const root = document.documentElement || document.head;
      if (!root) return setTimeout(inject, 10);
      const script = document.createElement('script');
      script.textContent = code;
      root.appendChild(script);
      script.remove();
    };
    inject();
  }

  function postBridge(type, payload = {}) {
    window.postMessage({ source: 'KZ_QUICK_CHECKOUT_SCRIPT', type, payload }, '*');
  }

  function listenBridge() {
    window.addEventListener('message', event => {
      const data = event.data || {};
      if (data.source !== 'KZ_QUICK_CHECKOUT_BRIDGE') return;
      let payload = {};
      try { payload = JSON.parse(data.payload || '{}'); } catch {}

      if (data.type === 'ORDER_INDEX_RESPONSE') {
        if (!isUnprintedTabActive()) {
          console.log('[KZ Checkout] resposta /api/order/index ignorada porque a aba não impressa não está ativa.');
          return;
        }
        state.refreshing = false;
        refreshSequence++;
        processOrderResponse(payload.json);
      } else if (data.type === 'NO_REPLAY_REQUEST') {
        setMessage('Capturando a consulta da aba Etiqueta não impressa...', 'info');
        forceReloadUnprintedTab().then(ok => {
          if (!ok) setMessage('Não consegui recarregar a aba Etiqueta não impressa.', 'error');
        });
      } else if (data.type === 'BRIDGE_ERROR') {
        console.warn('[KZ Checkout] bridge:', payload);
      }
    });
  }

  function findUnprintedTab() {
    const candidates = [...document.querySelectorAll('[role="tab"],.ant-tabs-tab,.el-tabs__item,button,div,span')];
    for (const element of candidates) {
      const text = norm(element.textContent).replace(/\s+/g, ' ');
      if (!/^Etiqueta\s*n[aã]o\s*impressa(?:\s*\(.*\)|\s*\d+)?$/i.test(text)) continue;
      const clickable = element.closest('[role="tab"],.ant-tabs-tab,.el-tabs__item,button') || element;
      if (clickable.getBoundingClientRect().width > 0) return clickable;
    }
    return null;
  }

  function isUnprintedTabActive() {
    const tab = findUnprintedTab();
    if (!tab) return false;
    const classText = `${tab.className || ''} ${tab.parentElement?.className || ''}`;
    return tab.getAttribute('aria-selected') === 'true' ||
      /ant-tabs-tab-active|is-active|\bactive\b/i.test(classText);
  }

  async function ensureUnprintedTab() {
    const tab = findUnprintedTab();
    if (!tab) return false;
    if (!isUnprintedTabActive()) {
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      tab.click();
      tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    return isUnprintedTabActive();
  }

  function findPrintedTab() {
    const candidates = [...document.querySelectorAll('[role="tab"],.ant-tabs-tab,.el-tabs__item,button,div,span')];
    for (const element of candidates) {
      const text = norm(element.textContent).replace(/\s+/g, ' ');
      if (!/^Etiqueta\s*impressa(?:\s*\(.*\)|\s*\d+)?$/i.test(text)) continue;
      const clickable = element.closest('[role="tab"],.ant-tabs-tab,.el-tabs__item,button') || element;
      if (clickable.getBoundingClientRect().width > 0) return clickable;
    }
    return null;
  }

  async function forceReloadUnprintedTab() {
    const printed = findPrintedTab();
    const unprinted = findUnprintedTab();
    if (!unprinted) return false;

    if (printed && isUnprintedTabActive()) {
      printed.click();
      await new Promise(resolve => setTimeout(resolve, 450));
    }

    unprinted.click();
    await new Promise(resolve => setTimeout(resolve, 900));
    return isUnprintedTabActive();
  }

  // Endpoint nativo do UpSeller (confirmado via captura de rede real feita pelo
  // usuário): dispara a re-tentativa de alocação de estoque pros pedidos "Sem
  // Estoque" da conta. Não recebe parâmetros. Retorna um uuid de job em
  // data, que precisa ser consultado em /api/check-process (mesmo padrão já
  // usado em generatePdfForOrder) até processMsg.code virar 1 (concluído) ou
  // -1 (falhou).
  async function triggerAutoRefreshStock() {
    let triggerJson;
    try {
      const result = await postJson('/api/order/auto-refresh-stock', {});
      triggerJson = result.json;
    } catch (error) {
      console.warn('[KZ Checkout] auto-refresh-stock: falha ao acionar:', error);
      return;
    }
    if (!isSuccess(triggerJson)) {
      console.warn('[KZ Checkout] auto-refresh-stock: resposta sem sucesso:', triggerJson);
      return;
    }
    const uuid = norm(triggerJson?.data);
    if (!uuid) return;

    for (let attempt = 1; attempt <= 25; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 650));
      let checkJson;
      try {
        const checkResponse = await fetch('/api/check-process?uuid=' + encodeURIComponent(uuid), {
          credentials: 'include',
        });
        checkJson = await checkResponse.json();
      } catch {
        continue;
      }
      let processMsg = checkJson?.data?.processMsg;
      if (typeof processMsg === 'string') {
        try { processMsg = JSON.parse(processMsg); } catch {}
      }

      if (processMsg?.code === 1 || processMsg?.code === '1') {
        appLog('info', 'auto_refresh_stock_concluido', {
          sucesso: processMsg?.successNum ?? processMsg?.data?.successList?.length ?? 0,
          total: processMsg?.totalNum,
        });
        return;
      }
      if (processMsg?.code === -1 || processMsg?.code === '-1') {
        console.warn('[KZ Checkout] auto-refresh-stock: job terminou com falha:', processMsg);
        return;
      }
    }
    console.warn('[KZ Checkout] auto-refresh-stock: tempo esgotado aguardando conclusão.');
  }

  async function requestOrdersRefresh(manual = false) {
    if (state.refreshing || state.loading || state.checkoutSession || document.getElementById('kzqc-modal')) return;
    state.refreshing = true;
    refreshSequence++;
    appLog('info', 'atualizacao_iniciada', { manual, sequencia: refreshSequence });
    const activeBefore = document.activeElement;
    const scannerWasFocused = activeBefore?.id === 'kzqc-scanner';
    if (manual) {
      skuDetailCache.clear();
      setMessage('Reavaliando estoque dos pedidos...', 'info');
      await triggerAutoRefreshStock();
      setMessage('Atualizando pedidos de Etiqueta não impressa...', 'info');
    }
    scheduleRender();

    try {
      // Consulta direta em segundo plano. Não clica em nenhuma aba do UpSeller.
      const list = await fetchAllUnprintedOrders();
      appLog('info', 'pedidos_recebidos_api', { quantidade: list.length, atrasadosBrutos: list.filter(o=>{const d=getOrderDeadline(o); return d && d.getTime()<Date.now();}).length, atrasados: list.map(o=>({ pedido:o?.orderNumber||o?.orderNo||o?.idStr, sku:(o?.orderItemList||[]).map(i=>i?.variationSku||i?.productSku).filter(Boolean), prazo:o?.orderTimeoutTimeStr||o?.orderTimeoutTime })).filter(o=>{const d=parseDateValue(o.prazo); return d && d.getTime()<Date.now();}).slice(0,100) });
      await processOrdersList(list, { silent: !manual });
    } catch (error) {
      appLog('error', 'falha_atualizacao', { mensagem: error?.message || String(error) });
      console.error('[KZ Checkout] atualização:', error);
      setMessage(error.message || String(error), 'error');
    } finally {
      state.refreshing = false;
      scheduleRender();
      // Só devolve o foco se o operador já estava no campo ou pediu atualização manual.
      if (manual || scannerWasFocused) setTimeout(focusScanner, 40);
    }
  }

  function extractOrderList(json) {
    const direct = [
      json?.data?.list,
      json?.data?.records,
      json?.data?.orderList,
      json?.data?.page?.list,
      json?.data?.page?.records,
      json?.data?.data?.list,
      json?.list,
      json?.records,
    ];
    for (const candidate of direct) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  async function fetchUnprintedOrdersPage(pageNum) {
    const body = new URLSearchParams();
    const params = {
      timeType: 0,
      searchType: 0,
      searchValue: '',
      sortName: 1,
      sortValue: 0,
      orderState: 'in_process',
      isVoided: 0,
      labelStatus: 'success',
      pageNum,
      pageSize: 300,
      warehouseType: 0,
      printCount: 0,
    };
    Object.entries(params).forEach(([key, value]) => body.set(key, String(value)));
    const result = await postForm('/api/order/index', body);
    if (!isSuccess(result.json)) {
      throw new Error(result.json?.msg || 'Falha ao consultar os pedidos não impressos.');
    }
    const data = result.json?.data || {};
    const pageList = Array.isArray(data.list) ? data.list : [];
    appLog('info', 'pagina_pedidos_recebida', { pagina: pageNum, registros: pageList.length, paginas: Number(data.pages || 1), total: Number(data.total || pageList.length) });
    const total = Math.max(pageList.length, Number(data.total || pageList.length));
    const pages = Math.max(1, Number(data.pages || Math.ceil(total / 300) || 1));
    return { list: pageList, pages, total };
  }

  async function fetchAllUnprintedOrders() {
    const first = await fetchUnprintedOrdersPage(1);
    const all = [...first.list];
    let page = 2;
    let expectedPages = first.pages;
    while (page <= expectedPages) {
      const next = await fetchUnprintedOrdersPage(page);
      all.push(...next.list);
      expectedPages = Math.max(expectedPages, next.pages || 1, Math.ceil((next.total || first.total || all.length) / 300));
      if (!next.list.length) break;
      page++;
    }
    const unique = [...new Map(all.map(order => [norm(order?.idStr || order?.id || order?.orderNumber), order])).values()];
    appLog('info', 'paginacao_concluida', { totalInformado:first.total||unique.length, paginasBuscadas:Math.max(1,page-1), totalConsolidado:unique.length });
    if (first.total && unique.length < first.total) appLog('warn','paginacao_incompleta',{totalInformado:first.total,totalCarregado:unique.length});
    return unique;
  }

  function detectItemQty(item) {
    const keys = [
      'goodsCount', 'productCount', 'qty', 'quantity', 'orderQty', 'count',
      'productNum', 'skuQty', 'goodsQty', 'itemQty', 'orderQuantity', 'num',
      'skuQuantity', 'componentQty', 'relationQty', 'warehouseQty', 'needQty', 'actualQty'
    ];
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && value !== '') {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
      }
    }
    return 1;
  }

  function getOrderPlatform(order) {
    const values = [
      order?.platform, order?.provider, order?.source, order?.platformName,
      order?.channel, order?.channelName, order?.shopPlatform
    ].map(value => norm(value).toLowerCase()).filter(Boolean);
    const shop = norm(order?.shopName || order?.storeName || order?.shop?.name).toLowerCase();
    const joined = `${values.join(' ')} ${shop}`;
    if (/mercado|mercadolivre|mercado_libre|\bml\b/.test(joined)) return 'mercado';
    if (/shopee|\bsh\b/.test(joined)) return 'shopee';
    if (/shein|\bsn\b/.test(joined)) return 'shein';
    if (/tiktok|tik tok|\btk\b/.test(joined)) return 'tiktok';
    if (/kwai|\bkw\b/.test(joined)) return 'kwai';
    return values[0] || 'outro';
  }

  function appLog(level, event, details = {}) {
    try {
      const row = {
        at: new Date().toISOString(),
        level: String(level || 'info'),
        event: String(event || 'evento'),
        details: details && typeof details === 'object' ? details : { value: String(details) }
      };
      state.systemLogs = [...(state.systemLogs || []), row].slice(-MAX_SYSTEM_LOGS);
      saveJson(STORAGE_LOGS, state.systemLogs);
      const fn = row.level === 'error' ? console.error : row.level === 'warn' ? console.warn : console.log;
      fn('[KZ Checkout Log]', row.event, row.details);
      return row;
    } catch (error) {
      console.warn('[KZ Checkout] falha ao gravar log', error);
      return null;
    }
  }

  function systemLogsText() {
    return (state.systemLogs || []).map(row => {
      let details = '';
      try { details = JSON.stringify(row.details || {}); } catch { details = String(row.details || ''); }
      return `[${row.at}] [${String(row.level || 'info').toUpperCase()}] ${row.event} ${details}`;
    }).join('\n');
  }

  function showSystemLogsModal() {
    document.getElementById('kzqc-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'kzqc-modal';
    const text = systemLogsText();
    modal.innerHTML = `<div class="kzqc-modal-card kzqc-modal-wide kzqc-log-modal"><div class="kzqc-modal-title">Logs do sistema</div><div class="kzqc-modal-subtitle">Histórico local das últimas ${MAX_SYSTEM_LOGS} ocorrências do checkout. Copie e cole no chat para diagnóstico.</div><textarea id="kzqc-log-text" readonly>${escapeHtml(text || 'Nenhum log registrado ainda.')}</textarea><div class="kzqc-modal-actions"><button id="kzqc-log-clear" class="danger">Limpar</button><button id="kzqc-cancel" class="secondary">Fechar</button><button id="kzqc-log-copy" class="primary">Copiar logs</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick = () => modal.remove();
    modal.querySelector('#kzqc-log-clear').onclick = () => {
      state.systemLogs = [];
      saveJson(STORAGE_LOGS, state.systemLogs);
      modal.remove();
      appLog('info', 'logs_limpos', {});
      showSystemLogsModal();
    };
    modal.querySelector('#kzqc-log-copy').onclick = async () => {
      const value = systemLogsText() || 'Nenhum log registrado.';
      try { await navigator.clipboard.writeText(value); setMessage('Logs copiados.', 'success'); }
      catch { const area=modal.querySelector('#kzqc-log-text'); area.select(); document.execCommand('copy'); }
    };
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
  }

  function getOrderShopName(order) {
    return norm(order?.shopName || order?.storeName || order?.shop?.name || order?.shopTitle || '');
  }

  function parseDateValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
      let n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (n > 1e12) return new Date(n);
      if (n > 1e9) return new Date(n * 1000);
      return null;
    }
    const text = norm(value);
    if (!text) return null;
    const relative = text.match(/(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m)/i);
    if (relative && (relative[1] || relative[2] || relative[3])) {
      const ms = (Number(relative[1] || 0) * 86400 + Number(relative[2] || 0) * 3600 + Number(relative[3] || 0) * 60) * 1000;
      if (ms > 0) return new Date(Date.now() + ms);
    }
    const br = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (br) {
      const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] || 0), Number(br[5] || 0), Number(br[6] || 0));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function deepDeadlineCandidates(node, depth = 0, out = []) {
    if (!node || typeof node !== 'object' || depth > 5) return out;
    for (const [key, value] of Object.entries(node)) {
      const keyText = String(key);
      if (/(expire|expiration|deadline|latest.*ship|ship.*by|last.*ship|send.*before|delivery.*limit|logistics.*limit|timeout)/i.test(keyText)) {
        const date = parseDateValue(value);
        if (date) out.push(date);
        const n = Number(value);
        if (Number.isFinite(n) && n > 0 && n < 60 * 60 * 24 * 45 && /(remain|left|countdown|expire)/i.test(keyText)) {
          out.push(new Date(Date.now() + n * 1000));
        }
      }
      if (value && typeof value === 'object') deepDeadlineCandidates(value, depth + 1, out);
    }
    return out;
  }

  function getOrderDeadline(order) {
    // orderTimeoutTimeStr/orderTimeoutTime é o prazo de envio real de cada pedido,
    // informado direto pelo UpSeller — usa ele sempre que existir, sem depender do
    // scanner genérico abaixo (que varre o objeto inteiro atrás de qualquer campo que
    // pareça prazo e pode acabar descartando um pedido atrasado há muitos dias por
    // causa da janela de tempo, ou pegando um campo secundário por engano).
    const direct = parseDateValue(order?.orderTimeoutTimeStr) || parseDateValue(order?.orderTimeoutTime);
    if (direct) return direct;

    const now = Date.now();
    const candidates = deepDeadlineCandidates(order)
      .filter(date => date instanceof Date && !Number.isNaN(date.getTime()))
      .filter(date => date.getTime() > now - 30 * 86400000 && date.getTime() < now + 180 * 86400000)
      .sort((a, b) => a - b);
    return candidates[0] || null;
  }


  function channelLabel(channel) {
    return CHANNELS.find(item => item.id === channel)?.label || channel || 'Outro';
  }

  function getBestSku(item) {
    return normSku(
      item?.sku ||
      item?.warehouseSku ||
      item?.variationSku ||
      item?.productSku ||
      item?.sellerSku || item?.skuCode || item?.skuNo || item?.warehouseSkuCode ||
      item?.componentSku || item?.childSku || item?.subSku || item?.goodsSku ||
      ''
    );
  }

  // Em kits, o detalhe pode trazer no mesmo objeto o SKU comercial do anúncio
  // e o SKU físico do armazém. Para a separação, o SKU físico precisa vencer.
  function getComponentSkuInfo(item) {
    const direct = [
      // O UpSeller usa groupVOS[].varSku para o SKU físico que será separado.
      // Ele precisa ter prioridade absoluta sobre groupVOS[].sku, que é o SKU comercial do kit.
      ['varSku', 160], ['varSkuCode', 160], ['variationWarehouseSku', 158],
      ['warehouseSku', 150], ['warehouseSkuCode', 150], ['warehouseSkuNo', 150],
      ['warehouseProductSku', 148], ['warehouseItemSku', 148], ['inventorySku', 146],
      ['componentSku', 145], ['componentSkuCode', 145], ['childSku', 142],
      ['subSku', 140], ['materialSku', 140], ['realSku', 138], ['stockSku', 136],
      ['goodsSku', 120], ['sellerSku', 70], ['variationSku', 65],
      ['productSku', 60], ['skuCode', 50], ['skuNo', 48], ['sku', 40],
    ];

    const candidates = [];
    for (const [key, score] of direct) {
      const value = item?.[key];
      if (typeof value === 'string' || typeof value === 'number') {
        const sku = normSku(value);
        if (sku) candidates.push({ sku, score, path: key });
      }
    }

    const seen = new Set();
    function walk(node, path = '', depth = 0) {
      if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        const nextPath = path ? `${path}.${key}` : key;
        if ((typeof value === 'string' || typeof value === 'number') && /sku/i.test(key)) {
          const sku = normSku(value);
          if (!sku) continue;
          const p = nextPath.toLowerCase();
          let score = 35;
          if (/(^|\.)varsku(code)?$/.test(p)) score = 160;
          else if (/warehouse|armaz|component|child|subsku|material|inventory|stock|real/.test(p)) score = 135;
          else if (/goods|seller|variation/.test(p)) score = 70;
          if (/id$|idstr|skuid/.test(key.toLowerCase())) score -= 45;
          candidates.push({ sku, score, path: nextPath });
        } else if (value && typeof value === 'object') {
          walk(value, nextPath, depth + 1);
        }
      }
    }
    walk(item);

    candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return candidates[0] || { sku: '', score: 0, path: '' };
  }

  function getComponentTitle(item) {
    return norm(
      item?.warehouseSkuTitle || item?.warehouseSkuName || item?.componentTitle ||
      item?.componentName || item?.childSkuTitle || item?.materialName ||
      item?.skuTitle || item?.productName || item?.title || item?.name || ''
    );
  }

  function getComponentImage(item) {
    return norm(
      item?.warehouseSkuImgUrl || item?.warehouseSkuImage || item?.componentImage ||
      item?.childSkuImage || item?.materialImage || item?.skuImage ||
      item?.imgUrl || item?.image || item?.productImg || item?.productImage || item?.imageUrl || ''
    );
  }

  function getItemTitle(item) {
    return norm(item?.title || item?.productName || item?.skuTitle || item?.name || '');
  }

  function getItemImage(item) {
    return norm(
      item?.image || item?.productImg || item?.warehouseSkuImgUrl ||
      item?.productImage || item?.imageUrl || item?.skuImage || ''
    );
  }

  function extractExactGroupVOS(payload) {
    const found = [];
    const seen = new Set();

    function walk(node, path = 'data', depth = 0) {
      if (!node || typeof node !== 'object' || depth > 10 || seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node?.groupVOS) && node.groupVOS.length) {
        const commercialSku = normSku(node?.sku || node?.productSku || node?.variationSku || node?.warehouseSku || '');
        // O groupVOS traz a quantidade de cada componente PARA 1 KIT (component.num).
        // Se o próprio kit foi comprado mais de uma vez nesse mesmo item de pedido
        // (ex.: productCount:2 pro kit), precisa multiplicar — senão um pedido de
        // 2x kit (par = 2 peças/kit) mostra só 2 peças pra separar em vez de 4.
        const kitMultiplier = detectItemQty(node);
        const rows = node.groupVOS.map(component => ({
          sku: normSku(component?.varSku || component?.warehouseSku || component?.componentSku),
          qty: Math.max(1, numberValue(component?.num ?? component?.goodsCount ?? 1, 1) * kitMultiplier),
          title: norm(component?.title || component?.varSkuTitle || component?.name),
          image: norm(component?.imgUrl || component?.imageUrl || component?.image),
          scanAliases: mergeScanAliases(
            component?.varSku || component?.warehouseSku || component?.componentSku,
            collectBarcodeCandidates(component)
          ),
        })).filter(row => row.sku);

        if (rows.length) {
          found.push({ rows, path: `${path}.groupVOS`, commercialSku });
        }
      }

      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      } else {
        Object.entries(node).forEach(([key, value]) => {
          if (value && typeof value === 'object') walk(value, `${path}.${key}`, depth + 1);
        });
      }
    }

    walk(payload);
    if (!found.length) return null;

    // Um pedido pode ter o MESMO kit comprado mais de uma vez (ex.: o mesmo kit em
    // tamanhos/variações diferentes), cada compra com seu próprio groupVOS separado
    // no payload. Antes disso escolhia só "o melhor" grupo e descartava os outros —
    // por isso um pedido com 2 kits (6 peças reais) só mostrava 3 peças pra separar.
    // Agora soma todas as compras via summarizeItems (que já agrupa por SKU e some
    // quantidade), então SKUs repetidos entre kits somam certo e SKUs diferentes
    // (como tamanhos diferentes do mesmo kit) aparecem todos.
    const combinedRows = [].concat(...found.map(entry => entry.rows));
    const summary = summarizeItems(combinedRows);
    return {
      rows: summary.rows,
      meta: {
        path: found.map(entry => entry.path).join(' + '),
        componentHits: combinedRows.length,
        avgSkuScore: 160,
        skuPaths: summary.rows.map(() => 'varSku'),
        exactGroupVOS: true,
        commercialSkus: [...new Set(found.map(entry => entry.commercialSku).filter(Boolean))],
      },
    };
  }

  function extractComponentRows(payload) {
    // Para kits acoplados, esta é a estrutura oficial observada no UpSeller:
    // data[0].groupVOS[].sku = SKU comercial do kit
    // data[0].groupVOS[].varSku = SKU físico usado na separação
    const exactGroup = extractExactGroupVOS(payload);
    if (exactGroup?.rows?.length) return exactGroup;

    const candidates = [];

    function inspectArray(arr, path, depth) {
      const parsed = arr.map(item => {
        const skuInfo = getComponentSkuInfo(item);
        return {
          sku: skuInfo.sku,
          qty: detectItemQty(item),
          title: getComponentTitle(item),
          image: getComponentImage(item),
          scanAliases: mergeScanAliases(skuInfo.sku, collectBarcodeCandidates(item)),
          _skuScore: skuInfo.score,
          _skuPath: skuInfo.path,
        };
      }).filter(item => item.sku);

      if (!parsed.length) return;
      const rows = parsed.map(({ _skuScore, _skuPath, ...row }) => row);
      const summary = summarizeItems(rows);
      const componentHits = parsed.filter(item => item._skuScore >= 100).length;
      const avgSkuScore = parsed.reduce((sum, item) => sum + item._skuScore, 0) / parsed.length;
      const pathBonus = /warehouse|component|child|material|sku.?order|detail|relation/i.test(path) ? 1 : 0;
      candidates.push({ rows, summary, path, depth, componentHits, avgSkuScore, pathBonus, parsed });
    }

    function walk(node, path = 'data', depth = 0) {
      if (!node || typeof node !== 'object' || depth > 9) return;
      if (Array.isArray(node)) {
        inspectArray(node, path, depth);
        node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        return;
      }
      Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`, depth + 1));
    }

    walk(payload);
    if (!candidates.length) return { rows: [], meta: null };

    candidates.sort((a, b) => {
      const aMulti = a.summary.distinctSkuCount > 1 ? 1 : 0;
      const bMulti = b.summary.distinctSkuCount > 1 ? 1 : 0;
      return bMulti - aMulti ||
        b.componentHits - a.componentHits ||
        b.pathBonus - a.pathBonus ||
        b.summary.distinctSkuCount - a.summary.distinctSkuCount ||
        b.avgSkuScore - a.avgSkuScore ||
        b.depth - a.depth ||
        b.summary.totalQty - a.summary.totalQty;
    });

    const best = candidates[0];
    return {
      rows: best.rows,
      meta: {
        path: best.path,
        componentHits: best.componentHits,
        avgSkuScore: Math.round(best.avgSkuScore),
        skuPaths: best.parsed.map(item => item._skuPath),
      },
    };
  }

  async function fetchDetailAttempt(order, platform) {
    const idStr = norm(order?.idStr || order?.id);
    const response = await fetch('/api/sku-order/detail', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify({ orderId: idStr, platform }),
    });
    const json = await response.json();
    if (!response.ok || !isSuccess(json)) {
      throw new Error(json?.msg || `HTTP ${response.status} em sku-order/detail`);
    }
    const extracted = extractComponentRows(json?.data ?? json);
    if (!extracted.rows.length) throw new Error('sku-order/detail não retornou SKUs reais.');
    return extracted;
  }

  async function fetchRealWarehouseItems(order) {
    const idStr = norm(order?.idStr || order?.id);
    if (!idStr) return null;
    if (skuDetailCache.has(idStr)) return skuDetailCache.get(idStr);

    const rawPlatform = norm(order?.platform || order?.provider || order?.source).toLowerCase();
    const normalizedPlatform = getOrderPlatform(order);
    const platforms = [...new Set([rawPlatform, normalizedPlatform].filter(Boolean))];
    let lastError = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      for (const platform of platforms) {
        try {
          const extracted = await fetchDetailAttempt(order, platform);
          const stable = Promise.resolve(extracted);
          skuDetailCache.set(idStr, stable);
          return extracted;
        } catch (error) {
          lastError = error;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }

    skuDetailCache.delete(idStr);
    console.warn('[KZ Checkout] não foi possível analisar composição real', order?.orderNumber || idStr, lastError);
    return null;
  }

  function fallbackMarketplaceItems(order) {
    const list = Array.isArray(order?.orderItemList) ? order.orderItemList : [];
    return list.map(item => ({
      sku: getBestSku(item),
      qty: detectItemQty(item),
      title: getItemTitle(item),
      image: getItemImage(item),
      scanAliases: mergeScanAliases(getBestSku(item), collectBarcodeCandidates(item)),
    })).filter(item => item.sku);
  }

  function summarizeItems(items) {
    const grouped = new Map();
    for (const item of items || []) {
      const sku = getBestSku(item) || normSku(item?.sku);
      if (!sku) continue;
      const qty = Math.max(1, detectItemQty(item));
      if (!grouped.has(sku)) {
        grouped.set(sku, {
          sku,
          qty: 0,
          title: getItemTitle(item),
          image: getItemImage(item),
          scanAliases: mergeScanAliases(sku, item?.scanAliases || item?.barcodes || collectBarcodeCandidates(item)),
        });
      }
      const row = grouped.get(sku);
      row.qty += qty;
      if (!row.title) row.title = getItemTitle(item);
      if (!row.image) row.image = getItemImage(item);
      row.scanAliases = mergeScanAliases(row.sku, row.scanAliases || [], item?.scanAliases || item?.barcodes || collectBarcodeCandidates(item));
    }
    const rows = [...grouped.values()];
    return {
      rows,
      distinctSkuCount: rows.length,
      totalQty: rows.reduce((sum, item) => sum + item.qty, 0),
    };
  }

  function isAfterSaleOrder(order) {
    const status = norm(order?.afterSaleStatus);
    if (status && status !== '0') return true;
    const errorText = typeof order?.errorMsg === 'string' ? order.errorMsg : JSON.stringify(order?.errorMsg || {});
    return /Order\.All\.Aftersales|abnormal_order_cannot_print_in_bulk/i.test(errorText);
  }

  async function normalizeOrder(order, index) {
    const idStr = norm(order?.idStr || order?.id);
    const authIdStr = norm(order?.authIdStr || order?.authId);
    const orderNo = norm(order?.orderNumber || order?.orderNo || order?.commonNo || order?.platformOrderNo);

    if (isAfterSaleOrder(order)) {
      appLog('warn', 'pedido_ignorado_pos_vendas', { pedido: orderNo || idStr, afterSaleStatus: order?.afterSaleStatus, errorMsg: order?.errorMsg || '' });
      return { key:idStr||orderNo||`row-${index}`, idStr, authIdStr, orderNo, category:'unknown', verified:false, eligible:false, realItems:[], marketplaceItems:[], raw:order, ignoredReason:'after_sales' };
    }

    const realResult = await fetchRealWarehouseItems(order);
    let realItems = Array.isArray(realResult?.rows) ? realResult.rows : [];
    const fallbackItems = fallbackMarketplaceItems(order);

    // Pedido misto: o detalhe pode trazer somente groupVOS do kit. Soma os itens
    // simples do pedido e remove apenas a linha comercial do kit identificada no detalhe.
    if (realResult?.meta?.exactGroupVOS) {
      const kitCommercialSkus = new Set((realResult.meta.commercialSkus || []).map(normSku));
      const simpleRows = fallbackItems.filter(item => !kitCommercialSkus.has(normSku(item.sku)));
      realItems = [...realItems, ...simpleRows];
      appLog('info', 'pedido_misto_expandido', { pedido: orderNo || idStr, componentesKit: realResult.rows?.length || 0, itensSimples: simpleRows.length });
    }

    let verified = realItems.length > 0;
    const fallbackSummary = summarizeItems(fallbackItems);
    const realSummary = summarizeItems(verified ? realItems : []);

    // Se o detalhe devolver o mesmo SKU comercial do anúncio com quantidade
    // inflada, os componentes foram colapsados. Nesse caso bloqueamos o pedido
    // em vez de colocá-lo incorretamente em Item Único (>1).
    if (verified && realSummary.distinctSkuCount === 1 && fallbackSummary.distinctSkuCount === 1) {
      const realRow = realSummary.rows[0];
      const fallbackRow = fallbackSummary.rows[0];
      if (realRow?.sku === fallbackRow?.sku && realSummary.totalQty > fallbackSummary.totalQty) {
        verified = false;
        console.warn('[KZ Checkout] composição suspeita descartada', {
          pedido: orderNo || idStr,
          skuComercial: fallbackRow.sku,
          qtdComercial: fallbackSummary.totalQty,
          qtdDetalhe: realSummary.totalQty,
          detalheMeta: realResult?.meta || null,
        });
      }
    }

    const displaySummary = verified ? realSummary : fallbackSummary;

    let category = 'unknown';
    if (verified && realSummary.distinctSkuCount === 1 && realSummary.totalQty === 1) category = 'single1';
    else if (verified && realSummary.distinctSkuCount === 1 && realSummary.totalQty > 1) category = 'singleMany';
    else if (verified && realSummary.distinctSkuCount > 1) category = 'multiple';

    if (category === 'unknown') {
      // Fica em "aguardando análise da composição" e não aparece em nenhuma aba —
      // logado aqui pra dar pra achar a causa real na próxima vez que isso acontecer.
      appLog('warn', 'pedido_categoria_desconhecida', { pedido: orderNo || idStr, idStr, prazo: order?.orderTimeoutTimeStr || order?.orderTimeoutTime || null, verified, realItemsCount: realItems.length });
      console.warn('[KZ Checkout] pedido com categoria desconhecida (não aparece em nenhuma aba)', {
        orderNo: orderNo || idStr,
        idStr,
        verified,
        realItemsCount: realItems.length,
        marketplaceItems: (order?.orderItemList || []).map(i => ({ sku: i?.productSku, qty: i?.productCount })),
        realResultMeta: realResult?.meta || null,
      });
    }

    const first = displaySummary.rows[0] || {};
    const marketFirst = Array.isArray(order?.orderItemList) ? order.orderItemList[0] : null;
    const sku = category === 'single1' || category === 'singleMany' ? first.sku : '';
    const deadline = getOrderDeadline(order);
    // priority costumava ser o menor entre o prazo real e um "corte operacional"
    // por canal (ex.: Shopee 15:00) — removido a pedido do usuário, o painel
    // mostra sempre o prazo oficial da plataforma, igual o nativo do UpSeller.
    const priority = deadline;
    const channel = getOrderPlatform(order);

    return {
      key: idStr || orderNo || `row-${index}`,
      idStr,
      authIdStr,
      orderNo,
      sku,
      title: first.title || getItemTitle(marketFirst),
      image: first.image || getItemImage(marketFirst),
      totalQty: displaySummary.totalQty,
      distinctSkuCount: displaySummary.distinctSkuCount,
      category,
      verified,
      eligible: Boolean(idStr && authIdStr && verified),
      marketplaceItems: fallbackSummary.rows,
      realItems: verified ? realSummary.rows : [],
      componentMeta: realResult?.meta || null,
      channel,
      shopName: getOrderShopName(order),
      warehouseId: norm(order?.warehouseIdStr || order?.warehouseId || order?.warehouse?.id || ''),
      warehouseName: norm(order?.warehouseName || order?.wareHouseName || order?.warehouse?.name || order?.warehouseIdStr || order?.warehouseId || 'Sem armazém'),
      deadlineAt: deadline ? deadline.toISOString() : '',
      priorityAt: priority ? priority.toISOString() : '',
      // "Vence hoje" também precisa cobrir pedidos já atrasados (prazo antes de hoje),
      // senão o filtro esconde exatamente os pedidos mais urgentes assim que o dia vira.
      dueToday: Boolean(deadline && deadline.getTime() <= new Date(new Date().setHours(23,59,59,999)).getTime() && deadline.getTime() >= Date.now() - 30 * 86400000),
      msgContent: norm(order?.msgContent),
      raw: order,
    };
  }

  async function mapWithConcurrency(list, limit, mapper) {
    const result = new Array(list.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= list.length) return;
        result[index] = await mapper(list[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length || 1) }, worker));
    return result;
  }

  async function processOrdersList(list, options = {}) {
    const silent = options.silent === true;
    const incomingFingerprint = stableOrderFingerprint(list);
    if (silent && incomingFingerprint === lastOrdersFingerprint) {
      state.refreshing = false;
      return false;
    }
    lastOrdersFingerprint = incomingFingerprint;
    state.rawCount = list.length;
    if (!silent) {
      setMessage(`Analisando os SKUs reais de ${list.length} pedido(s)...`, 'info');
      scheduleRender();
    }

    let done = 0;
    const normalized = await mapWithConcurrency(list, 3, async (order, index) => {
      const value = await normalizeOrder(order, index);
      done++;
      if (!silent && (done % 5 === 0 || done === list.length)) {
        setMessage(`Analisando itens reais: ${done}/${list.length} pedido(s)...`, 'info');
      }
      return value;
    });

    const blockedPrintedIds = new Set([...(state.pending?.orderIds || []), ...(state.unknownPrint?.orderIds || [])].map(norm));
    state.orders = normalized.filter(order => order.idStr && !blockedPrintedIds.has(norm(order.idStr)));
    if (!silent) setMessage('Carregando códigos de barras e GTIN dos SKUs...', 'info');
    await enrichOrdersWithSkuScanInfo(state.orders);
    state.analysisFailures = state.orders.filter(order => !order.verified).length;
    appLog('info', 'pedidos_classificados', { total: state.orders.length, atrasados: state.orders.filter(o=>o.deadlineAt && new Date(o.deadlineAt).getTime()<Date.now()).length, falhasAnalise: state.analysisFailures });
    state.lastCaptureAt = new Date().toISOString();

    const counts = getCategoryCounts();
    if (!silent) {
      setMessage(
        `Atualizado: ${counts.single1} Item Único (=1), ${counts.singleMany} Item Único (>1), ` +
        `${counts.multiple} Múltiplos Itens${counts.unknown ? `, ${counts.unknown} aguardando nova análise` : ''}.`,
        'success'
      );
    }
    console.log('[KZ Checkout] classificação:', counts, state.orders);
    scheduleRender();
  }

  async function processOrderResponse(json) {
    const list = extractOrderList(json);
    if (!list.length || state.refreshing) return;
    await processOrdersList(list, { silent: true });
  }


  function stableOrderFingerprint(list) {
    try {
      return JSON.stringify((list || []).map(order => ({
        id: norm(order?.idStr || order?.id),
        no: norm(order?.orderNumber || order?.orderNo),
        label: norm(order?.labelStatus),
        print: Number(order?.isPrintLabel || 0),
        deadline: norm(order?.orderTimeoutTime || order?.orderTimeoutTimeStr || order?.toShipTime),
        items: (order?.orderItemList || order?.items || []).map(item => ({
          id: norm(item?.idStr || item?.id),
          sku: norm(item?.variationSku || item?.warehouseSku || item?.sku),
          qty: Number(item?.productCount || item?.goodsCount || item?.qty || item?.quantity || 0)
        }))
      })).sort((a,b)=>a.id.localeCompare(b.id)));
    } catch { return String(Date.now()); }
  }

  function warehouseDisplayName(rawName) {
    const key = norm(rawName || 'Sem armazém');
    return norm(state.warehouseAliases?.[key] || key);
  }
  function saveWarehouseAliases() { saveJson(STORAGE_WAREHOUSE_ALIASES, state.warehouseAliases || {}); }
  function showWarehouseRenameModal() {
    document.getElementById('kzqc-modal')?.remove();
    const names=[...new Set(state.orders.map(o=>o.warehouseName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const modal=document.createElement('div'); modal.id='kzqc-modal';
    modal.innerHTML=`<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">Renomear armazéns</div><div class="kzqc-modal-subtitle">O novo nome será exibido somente neste checkout. O nome original do UpSeller não será alterado.</div><div class="kzqc-warehouse-rename-list">${names.map((name,i)=>`<label><span>${escapeHtml(name)}</span><input data-wh-original="${escapeHtml(name)}" value="${escapeHtml(state.warehouseAliases?.[name]||'')}" placeholder="Nome personalizado"></label>`).join('')}</div><div class="kzqc-modal-actions"><button id="kzqc-cancel" class="secondary">Cancelar</button><button id="kzqc-save-wh" class="primary">Salvar</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick=()=>modal.remove();
    modal.querySelector('#kzqc-save-wh').onclick=()=>{
      const next={...(state.warehouseAliases||{})};
      modal.querySelectorAll('[data-wh-original]').forEach(input=>{const k=input.dataset.whOriginal;const v=norm(input.value);if(v)next[k]=v;else delete next[k]});
      state.warehouseAliases=next; saveWarehouseAliases(); modal.remove(); renderPanel();
    };
  }

  // Alt+Click num pedido abre isto. Sequência real confirmada por captura de rede feita
  // pelo usuário: anular (mark=1) -> sku-order/edit-relation por item -> redefinir (mark=0).
  // Itens com isGroup:1 (kit agregado, ex: "Kit Aleatório") usam o mesmo edit-relation:
  // orderItemId do kit + skuInfoList com um {skuId,count} por componente do kit — mesma
  // captura confirmou isso, então reaproveita a UI de multi-produto sem trava nenhuma.
  async function openProductChangeModal(order) {
    document.getElementById('kzqc-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'kzqc-modal';
    modal.innerHTML = `<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">Trocar produto — Pedido ${escapeHtml(order.orderNo || order.idStr)}</div><div class="kzqc-modal-subtitle">Carregando composição atual...</div><div class="kzqc-pc-list"></div><div class="kzqc-modal-actions"><button id="kzqc-pc-cancel" class="secondary">Cancelar</button><button id="kzqc-pc-confirm" class="primary" disabled>Confirmar troca</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-pc-cancel').onclick = () => modal.remove();
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });

    const subtitle = modal.querySelector('.kzqc-modal-subtitle');
    let items;
    try { items = await fetchOrderRelationDetail(order); }
    catch (error) { subtitle.textContent = error.message || String(error); return; }
    if (!document.body.contains(modal)) return;
    if (!items.length) { subtitle.textContent = 'Não encontrei a composição real deste pedido.'; return; }

    subtitle.textContent = 'Escolha um ou mais produtos substitutos para cada item — dá pra dividir a quantidade entre produtos diferentes. Ao confirmar, o pedido é anulado, trocado e redefinido automaticamente.';
    const chosenByItem = new Map();
    const confirmBtn = modal.querySelector('#kzqc-pc-confirm');
    const list = modal.querySelector('.kzqc-pc-list');

    list.innerHTML = items.map(item => `
      <div class="kzqc-pc-row" data-order-item-id="${escapeHtml(item.orderItemId)}">
        <div class="kzqc-pc-current">
          ${item.isGroup && Array.isArray(item.groupVOS) && item.groupVOS.length ? `<div class="kzqc-pc-kit-current"><b>${escapeHtml(item.title || item.sku)}</b>${item.groupVOS.map(comp => `<div class="kzqc-pc-kit-comp">${comp.imgUrl ? `<img src="${escapeHtml(comp.imgUrl)}">` : '<span class="kzqc-pc-noimg"></span>'}<span>${Number(comp.num || comp.goodsCount || 1)}× ${escapeHtml(comp.varSku || comp.sku || '')} <small>${escapeHtml(comp.title || '')}</small></span></div>`).join('')}</div>` : `${item.imgUrl ? `<img src="${escapeHtml(item.imgUrl)}">` : '<span class="kzqc-pc-noimg"></span>'}<div><b>${Number(item.goodsCount || 1)}× ${escapeHtml(item.sku)}</b><small>${escapeHtml(item.title || '')}</small></div>`}
        </div>
        <div class="kzqc-pc-arrow">→</div>
        <div class="kzqc-pc-target">
          ${item.isGroup ? '<div class="kzqc-pc-hint">Kit aleatório — as peças originais já estão na lista abaixo. Adicione um substituto só pra peça que quer trocar, ou clique no × pra remover uma peça sem substituir.</div>' : ''}
          <div class="kzqc-pc-chosen"></div>
          <input class="kzqc-pc-search" type="text" placeholder="Buscar e adicionar produto substituto...">
          <div class="kzqc-pc-results"></div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.kzqc-pc-row').forEach(row => {
      const orderItemId = row.dataset.orderItemId;
      const item = items.find(entry => String(entry.orderItemId) === orderItemId);
      const searchInput = row.querySelector('.kzqc-pc-search');
      const resultsBox = row.querySelector('.kzqc-pc-results');
      const chosenBox = row.querySelector('.kzqc-pc-chosen');
      let searchTimer = null;

      // skuInfoList substitui A COMPOSIÇÃO INTEIRA do item no edit-relation (não é
      // incremental) — confirmado pelo comportamento real: trocar só 1 peça de um kit
      // sem reenviar as outras apaga elas do pedido. Pra não perder peça nenhuma que o
      // usuário não pretende trocar, pré-carrega aqui as peças originais do kit
      // (item.groupVOS) já como "escolhidas" — o usuário só remove/edita o que quiser
      // mudar. O nome exato do campo de ID de cada componente nunca foi confirmado por
      // captura de rede (groupVOS só era usado pra exibição até agora), então tenta os
      // candidatos mais prováveis e loga o objeto bruto no console pra conferência.
      const original = item?.isGroup && Array.isArray(item.groupVOS)
        ? item.groupVOS.map(comp => {
            console.log('[Kryzer Checkout] componente original do kit (bruto)', comp);
            return {
              skuId: comp.skuId ?? comp.varSkuId ?? comp.idStr ?? comp.id ?? comp.warehouseSkuId ?? '',
              sku: comp.varSku || comp.sku || '',
              title: comp.title || '',
              imgUrl: comp.imgUrl || '',
              available: comp.available ?? '',
              count: Math.max(1, Number(comp.num || comp.goodsCount || 1)),
              original: true,
            };
          })
        : [];
      chosenByItem.set(orderItemId, original);

      const syncConfirmState = () => {
        confirmBtn.disabled = ![...chosenByItem.values()].some(entries => entries.length);
      };

      const renderChosen = () => {
        const chosen = chosenByItem.get(orderItemId);
        chosenBox.innerHTML = chosen.map((entry, idx) => `<div class="kzqc-pc-selected" data-idx="${idx}">${entry.imgUrl ? `<img src="${escapeHtml(entry.imgUrl)}">` : '<span class="kzqc-pc-noimg"></span>'}<div><b>${escapeHtml(entry.sku)}</b><small>${escapeHtml(entry.title || '')}${entry.original ? ' · peça original, não mexida' : ''}</small><em>Estoque: ${Number(entry.available || 0)}</em></div><label class="kzqc-pc-qty">Qtd <input type="number" min="1" value="${entry.count}"></label><button type="button" class="kzqc-pc-clear">×</button></div>`).join('');
        chosenBox.querySelectorAll('.kzqc-pc-selected').forEach(node => {
          const idx = Number(node.dataset.idx);
          node.querySelector('input').addEventListener('input', event => { chosen[idx].count = Math.max(1, Number(event.target.value || 1)); });
          node.querySelector('.kzqc-pc-clear').onclick = () => { chosen.splice(idx, 1); renderChosen(); syncConfirmState(); };
        });
      };
      renderChosen();
      syncConfirmState();

      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const value = searchInput.value.trim();
        if (!value) { resultsBox.innerHTML = ''; return; }
        searchTimer = setTimeout(async () => {
          resultsBox.innerHTML = '<div class="kzqc-pc-loading">Buscando...</div>';
          try {
            const results = await searchReplacementSku(value, order.warehouseId);
            if (!document.body.contains(modal)) return;
            if (!results.length) { resultsBox.innerHTML = '<div class="kzqc-pc-loading">Nenhum produto encontrado.</div>'; return; }
            resultsBox.innerHTML = results.slice(0, 12).map(product => `<button type="button" class="kzqc-pc-result" data-sku-id="${escapeHtml(product.idStr || product.id)}">${product.imgUrl ? `<img src="${escapeHtml(product.imgUrl)}">` : '<span class="kzqc-pc-noimg"></span>'}<span><b>${escapeHtml(product.sku)}</b><small>${escapeHtml(product.title || '')}</small></span><em>Estoque: ${Number(product.available || 0)}</em></button>`).join('');
            resultsBox.querySelectorAll('.kzqc-pc-result').forEach(btn => {
              const product = results.find(entry => String(entry.idStr || entry.id) === btn.dataset.skuId);
              btn.onclick = () => {
                const chosen = chosenByItem.get(orderItemId);
                const defaultQty = (item.isGroup || chosen.length) ? 1 : Number(item.goodsCount || 1);
                chosen.push({ skuId: product.idStr || product.id, sku: product.sku, title: product.title, imgUrl: product.imgUrl, available: product.available, count: defaultQty });
                renderChosen();
                syncConfirmState();
                searchInput.value = '';
                resultsBox.innerHTML = '';
                searchInput.focus();
              };
            });
          } catch (error) {
            if (document.body.contains(modal)) resultsBox.innerHTML = `<div class="kzqc-pc-loading">${escapeHtml(error.message || String(error))}</div>`;
          }
        }, 350);
      });
    });

    confirmBtn.onclick = async () => {
      const changes = [];
      for (const [orderItemId, chosen] of chosenByItem.entries()) {
        if (!chosen.length) continue;
        changes.push({ orderItemId, warehouseId: order.warehouseId, skuInfoList: chosen.map(entry => ({ skuId: entry.skuId, count: entry.count })) });
      }
      if (!changes.length) return;
      modal.remove();
      await runProductChangeSequence(order, changes);
    };
  }

  function abnormalSet() {
    return ENABLE_ABNORMAL_ORDERS ? new Set((state.abnormalIds || []).map(norm)) : new Set();
  }
  function saveAbnormal() { saveJson(STORAGE_ABNORMAL, state.abnormalIds || []); saveJson(STORAGE_ABNORMAL_REASONS, state.abnormalReasons || {}); }
  function markOrdersAbnormal(orders, reason = '') {
    if (!ENABLE_ABNORMAL_ORDERS) return;
    const set = abnormalSet();
    (orders || []).forEach(order => {
      if (!order?.idStr) return;
      const id = norm(order.idStr); set.add(id);
      if (reason) state.abnormalReasons[id] = reason;
    });
    state.abnormalIds = [...set];
    saveAbnormal();
    state.orders = [...state.orders];
    setMessage(`${(orders || []).length} pedido(s) movido(s) para Pedidos anormais.`, 'warn');
    renderPanel();
  }
  function restoreAbnormalOrder(id) {
    const key = norm(id);
    state.abnormalIds = (state.abnormalIds || []).filter(value => norm(value) !== key);
    delete state.abnormalReasons[key];
    saveAbnormal();
    renderPanel();
  }

  function selectOrdersForAbnormalSku(sku, quantity) {
    const key = normSku(sku); const blocked = abnormalSet();
    const candidates = state.orders.filter(order => order.eligible && !blocked.has(order.idStr) && (order.realItems || []).some(item => normSku(item.sku) === key));
    const rank = { single1:0, singleMany:1, multiple:2 };
    candidates.sort((a,b) => (rank[a.category] ?? 9) - (rank[b.category] ?? 9) || orderSortValue(b) - orderSortValue(a));
    return candidates.slice(0, Math.max(0, Number(quantity || 0)));
  }

  function showOrderAbnormalModal(order, reasonSku = '') {
    if (!ENABLE_ABNORMAL_ORDERS) return;
    if (!order) return;
    document.getElementById('kzqc-modal')?.remove();
    const modal=document.createElement('div'); modal.id='kzqc-modal';
    const reason = reasonSku ? `Falta/Problema no SKU ${reasonSku}` : 'Marcado manualmente pela lista';
    modal.innerHTML=`<div class="kzqc-modal-card"><div class="kzqc-modal-title">Enviar pedido para anormal?</div><div class="kzqc-modal-subtitle"><b>${escapeHtml(order.orderNo||order.idStr)}</b>${reasonSku?` · motivo: ${escapeHtml(reasonSku)}`:''}</div><div class="kzqc-modal-actions kzqc-compact-actions"><button id="kzqc-order-abnormal" class="danger">Anormal</button><button id="kzqc-cancel" class="secondary">Cancelar</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick=()=>modal.remove();
    modal.querySelector('#kzqc-order-abnormal').onclick=()=>{modal.remove();markOrdersAbnormal([order],reason)};
  }

  function bindSingleDoubleClick(element, onSingle, onDouble) {
    let timer = null;
    element.addEventListener('click', event => {
      if (event.target.closest('button,input,select,a')) return;
      if (timer) { clearTimeout(timer); timer = null; onDouble?.(event); }
      else timer = setTimeout(() => { timer = null; onSingle?.(event); }, 240);
    });
  }

  function showSkuAbnormalModal(sku, availableCount) {
    if (!ENABLE_ABNORMAL_ORDERS) return;
    document.getElementById('kzqc-modal')?.remove();
    const max = Math.max(1, Number(availableCount || 1));
    const modal = document.createElement('div'); modal.id='kzqc-modal';
    modal.innerHTML=`<div class="kzqc-modal-card"><div class="kzqc-modal-title">Marcar ${escapeHtml(sku)} como anormal</div><div class="kzqc-modal-subtitle">O sistema prioriza pedidos de item único e, entre eles, escolhe os que vencem mais tarde.</div><label class="kzqc-label">Quantidade de pedidos</label><input id="kzqc-abnormal-qty" class="kzqc-modal-input" type="number" min="1" max="${max}" value="1"><div class="kzqc-modal-hint">Disponíveis: ${max} pedido(s). Em kits ou múltiplos itens, o pedido inteiro será movido.</div><div class="kzqc-modal-actions"><button id="kzqc-cancel" class="secondary">Cancelar</button><button id="kzqc-abnormal-confirm" class="danger">Anormal</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick=()=>modal.remove();
    modal.querySelector('#kzqc-abnormal-confirm').onclick=()=>{
      const qty=Math.min(max,Math.max(1,Number(modal.querySelector('#kzqc-abnormal-qty').value||1)));
      const selected=selectOrdersForAbnormalSku(sku,qty);
      modal.remove(); markOrdersAbnormal(selected, `Falta/Problema no SKU ${sku}`);
    };
  }

  function detectSize(orderOrItem) {
    const text = JSON.stringify(orderOrItem || {}).toUpperCase();
    const sku = normSku(orderOrItem?.sku || orderOrItem?.realItems?.[0]?.sku || '');
    const explicit = text.match(/(?:TAMANHO|SIZE|VARIANT)[^A-Z0-9]{0,8}(PP|GG|P|M|G)\b/);
    if (explicit) return explicit[1];
    if (/\bPP\b/.test(text)) return 'PP';
    if (/\bGG\b/.test(text)) return 'GG';
    if (/\bTAMANHO\s*[:=-]?\s*P\b/.test(text)) return 'P';
    if (/\bTAMANHO\s*[:=-]?\s*M\b/.test(text)) return 'M';
    if (/\bTAMANHO\s*[:=-]?\s*G\b/.test(text)) return 'G';
    const suffix = sku.match(/(00|02|04|06|08)$/)?.[1];
    return ({'00':'PP','02':'P','04':'M','06':'G','08':'GG'})[suffix] || '';
  }

  function skuFilterMatches(order) {
    const query = state.skuFilters?.query || '';
    const hay = [order.sku, order.title, order.orderNo, ...(order.realItems || []).flatMap(i => [i.sku,i.title])].join(' ');
    return wildcardMatches(hay, query);
  }

  function multipleSignature(order) {
    return (order.realItems || []).map(i => `${normSku(i.sku)}:${Number(i.qty||0)}`).sort().join('|');
  }
  function groupMultipleOrders() {
    const map = new Map();
    for (const order of getAvailableOrders('multiple')) {
      const key = multipleSignature(order);
      if (!map.has(key)) map.set(key, { signature:key, orders:[], required:order.realItems || [], earliestPriorityAt:'', dueTodayCount:0 });
      const group = map.get(key); group.orders.push(order);
      if (order.dueToday) group.dueTodayCount++;
      if (!group.earliestPriorityAt || orderSortValue(order) < new Date(group.earliestPriorityAt).getTime()) group.earliestPriorityAt = order.priorityAt || order.deadlineAt || '';
    }
    return [...map.values()].sort((a,b)=>orderSortValue(a.orders[0])-orderSortValue(b.orders[0]));
  }

  function aggregateSkuQueue() {
    const map = new Map();
    const blocked = abnormalSet();
    const warehouses = new Set(state.skuFilters?.warehouses || []);
    for (const order of state.orders) {
      if (!order.eligible || blocked.has(order.idStr) || !orderMatchesFilters(order)) continue;
      if (state.skuFilters?.currentTabOnly !== false && order.category !== state.activeTab) continue;
      if (warehouses.size && !warehouses.has(order.warehouseName)) continue;
      for (const item of order.realItems || []) {
        const key = normSku(item.sku); if (!key) continue;
        if (!map.has(key)) map.set(key,{sku:key,title:item.title||order.title||'',image:item.image||order.image||'',qty:0,orders:0,warehouses:new Set()});
        const row=map.get(key); row.qty += Number(item.qty||0); row.orders += 1; row.warehouses.add(order.warehouseName);
      }
    }
    return [...map.values()]
      .map(row=>({...row,warehouses:[...row.warehouses]}))
      .sort((a,b)=>a.sku.localeCompare(b.sku,'pt-BR',{numeric:true,sensitivity:'base'}));
  }

  function applySkuQueueSearch(panel = document.getElementById('kzqc-panel')) {
    if (!panel) return;
    const input = panel.querySelector('#kzqc-sku-filter');
    const query = input?.value || state.skuFilters?.query || '';
    const rows = [...panel.querySelectorAll('.kzqc-sku-queue-row')];
    let visible = 0;
    for (const row of rows) {
      const haystack = row.dataset.search || '';
      const show = wildcardMatches(haystack, query);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    let empty = panel.querySelector('.kzqc-sku-search-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'kzqc-empty kzqc-sku-search-empty';
      empty.textContent = 'Nenhum SKU encontrado.';
      panel.querySelector('.kzqc-sku-queue-list')?.appendChild(empty);
    }
    empty.style.display = rows.length && visible === 0 ? '' : 'none';
  }

  function deadlineLevel(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return 'critical';
    if (ms < 12 * 3600000) return 'critical';
    if (ms < 24 * 3600000) return 'warning';
    return 'safe';
  }

  function updateCountdowns() {
    document.querySelectorAll('[data-deadline]').forEach(el => {
      el.textContent = `Expira · ${formatRemaining(el.dataset.deadline)}`;
      el.classList.remove('safe','warning','critical');
      el.classList.add(deadlineLevel(el.dataset.deadline));
    });
  }

  function showAbnormalModal() {
    if (!ENABLE_ABNORMAL_ORDERS) return;
    document.getElementById('kzqc-modal')?.remove();
    const set=abnormalSet();
    const rows=state.orders.filter(o=>set.has(o.idStr));
    const modal=document.createElement('div'); modal.id='kzqc-modal';
    modal.innerHTML=`<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">Pedidos anormais</div><div class="kzqc-modal-subtitle">Pedidos removidos temporariamente da separação.</div><div class="kzqc-abnormal-list">${rows.length?rows.map(o=>`<div class="kzqc-abnormal-row"><div><b>${escapeHtml(o.orderNo||o.idStr)}</b><small>${escapeHtml((o.realItems||[]).map(i=>`${i.qty}× ${i.sku}`).join(' · '))}</small><em>Motivo: ${escapeHtml(state.abnormalReasons?.[o.idStr] || 'Marcado manualmente')}</em></div><button data-restore="${escapeHtml(o.idStr)}">Voltar para separação</button></div>`).join(''):'<div class="kzqc-empty">Nenhum pedido anormal.</div>'}</div><div class="kzqc-modal-actions"><button id="kzqc-cancel" class="secondary">Fechar</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick=()=>modal.remove();
    modal.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{restoreAbnormalOrder(b.dataset.restore);showAbnormalModal();});
  }

  function showStockShortageModal() {
    document.getElementById('kzqc-modal')?.remove();
    const entries = Object.entries(state.stockShortages || {});
    const modal = document.createElement('div'); modal.id = 'kzqc-modal';
    modal.innerHTML = `<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">Produtos sem estoque</div><div class="kzqc-modal-subtitle">Marcados digitando -SKU*quantidade no campo de leitura (ex.: -14947*3). Remova pra o SKU voltar a ser contado normalmente.</div><div class="kzqc-abnormal-list">${entries.length ? entries.map(([sku, qty]) => {
      const sampleItem = state.orders.flatMap(o => o.realItems || []).find(i => normSku(i.sku) === sku) || null;
      return `<div class="kzqc-abnormal-row"><div style="display:flex;align-items:center;gap:10px">${sampleItem?.image ? `<img src="${escapeHtml(sampleItem.image)}" style="width:40px;height:40px;object-fit:contain;border:1px solid #eee;border-radius:6px;flex:0 0 auto">` : '<span class="kzqc-pc-noimg"></span>'}<div><b>${escapeHtml(sku)}</b><small>${escapeHtml(sampleItem?.title || '')}</small><em>${Number(qty)} unidade(s) sem estoque</em></div></div><button data-clear-shortage="${escapeHtml(sku)}">×</button></div>`;
    }).join('') : '<div class="kzqc-empty">Nenhum SKU marcado sem estoque.</div>'}</div><div class="kzqc-modal-actions"><button id="kzqc-cancel" class="secondary">Fechar</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-cancel').onclick = () => modal.remove();
    modal.querySelectorAll('[data-clear-shortage]').forEach(b => b.onclick = () => { clearStockShortage(b.dataset.clearShortage); modal.remove(); showStockShortageModal(); });
  }

  function showMultipleMassModal(group) {
    if (!group || group.orders.length < 2) { if (group?.orders?.[0]) startCheckout(group.orders[0]); return; }
    document.getElementById('kzqc-modal')?.remove();
    const max=group.orders.length; const modal=document.createElement('div'); modal.id='kzqc-modal';
    modal.innerHTML=`<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">${max} pedidos com composição idêntica</div><div class="kzqc-modal-subtitle">Imprimir em massa e separar todos juntos?</div><div class="kzqc-bulk-components">${group.required.map(i=>`<div class="kzqc-bulk-row">${i.image?`<img src="${escapeHtml(i.image)}">`:'<span class="kzqc-bulk-row-noimg"></span>'}<span class="kzqc-bulk-row-copy"><b>${escapeHtml(enrichedTitle(i))}</b><small>SKU ${escapeHtml(i.sku)}</small></span><em>${max*Number(i.qty||0)}×</em></div>`).join('')}</div><div class="kzqc-modal-actions kzqc-compact-actions"><button id="kzqc-abnormal-all" class="danger">Anormal</button><button id="kzqc-one" class="secondary">Cancelar</button><button id="kzqc-mass" class="primary">Imprimir</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-abnormal-all').onclick=()=>{modal.remove();markOrdersAbnormal(group.orders)};
    modal.querySelector('#kzqc-one').onclick=()=>{modal.remove();focusScanner()};
    modal.querySelector('#kzqc-mass').onclick=()=>{modal.remove();startBulkCheckout(group.orders)};
  }
  function getCategoryCounts() {
    const counts = { single1: 0, singleMany: 0, multiple: 0, unknown: 0 };
    for (const order of state.orders) {
      if (Object.prototype.hasOwnProperty.call(counts, order.category)) counts[order.category]++;
      else counts.unknown++;
    }
    return counts;
  }

  function getFilteredCategoryCounts() {
    const counts = { single1: 0, singleMany: 0, multiple: 0, unknown: 0 };
    const blocked = pendingOrderIdSet();
    for (const order of state.orders) {
      if (blocked.has(order.idStr) || abnormalSet().has(order.idStr) || !orderMatchesFilters(order)) continue;
      if (Object.prototype.hasOwnProperty.call(counts, order.category)) counts[order.category]++;
      else counts.unknown++;
    }
    return counts;
  }

  function pendingOrderIdSet() {
    return new Set([...(state.pending?.orderIds || []), ...(state.unknownPrint?.orderIds || [])].map(norm));
  }

  // Modelo de filtro por marketplace: state.filters.channelSelection é um objeto
  // { [channelId]: 'all' | [nomesDeLoja...] }. Canal ausente do objeto = não filtrado
  // (mostra tudo). 'all' = mostra todas as lojas daquele canal. Um array = mostra só
  // as lojas listadas daquele canal. Isso permite estados independentes por marketplace
  // (ex.: Kwai inteiro + só a loja Vektor do Mercado Livre, ao mesmo tempo).
  function channelSelectionMap() {
    const raw = state.filters?.channelSelection;
    return raw && typeof raw === 'object' ? raw : {};
  }

  function normalizedShopName(order) {
    return norm(order?.shopName || getOrderShopName(order)).toUpperCase();
  }

  function availableChannels() {
    const counts = new Map();
    for (const order of state.orders || []) {
      const id = norm(order?.channel).toLowerCase();
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const known = new Map(CHANNELS.map(channel => [channel.id, channel]));
    return [...counts.entries()]
      .map(([id, count]) => {
        const channel = known.get(id);
        const label = channel?.label || id.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
        return { id, label, count };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function storesForChannel(channelId) {
    const counts = new Map();
    for (const order of state.orders || []) {
      if (norm(order?.channel).toLowerCase() !== channelId) continue;
      const name = normalizedShopName(order);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].map(([name,count])=>({name,count})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  }

  function orderMatchesFilters(order) {
    const selection = channelSelectionMap();
    const channelIds = Object.keys(selection);
    if (channelIds.length) {
      const channelId = norm(order?.channel).toLowerCase();
      const sel = selection[channelId];
      if (!sel) return false;
      if (sel !== 'all') {
        const shopName = normalizedShopName(order);
        if (!Array.isArray(sel) || !sel.includes(shopName)) return false;
      }
    }
    if (state.filters?.onlyToday && !order.dueToday) return false;
    return true;
  }

  function orderSortValue(order) {
    const time = order?.priorityAt ? new Date(order.priorityAt).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }

  function orderPrimarySku(order) {
    return normSku(order?.sku || order?.realItems?.[0]?.sku || '');
  }

  function naturalSkuCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'pt-BR', { numeric:true, sensitivity:'base' });
  }

  function sortOrdersByPriority(list) {
    return [...list].sort((a, b) => {
      if (state.filters?.priorityFirst !== false) {
        const diff = orderSortValue(a) - orderSortValue(b);
        if (diff) return diff;
      } else {
        const skuDiff = naturalSkuCompare(orderPrimarySku(a), orderPrimarySku(b));
        if (skuDiff) return skuDiff;
      }
      return String(a.orderNo || a.idStr).localeCompare(String(b.orderNo || b.idStr), 'pt-BR', { numeric: true });
    });
  }

  function getAvailableOrders(category = state.activeTab) {
    const blocked = pendingOrderIdSet();
    return sortOrdersByPriority(state.orders.filter(order =>
      order.category === category && order.eligible && !blocked.has(order.idStr) && !abnormalSet().has(order.idStr) && orderMatchesFilters(order)
    ));
  }

  function groupOrdersBySku(category = state.activeTab) {
    const groups = new Map();
    for (const order of getAvailableOrders(category)) {
      const sku = order.sku || order.realItems?.[0]?.sku || '';
      if (!sku) continue;
      if (!groups.has(sku)) {
        groups.set(sku, {
          sku,
          title: order.title,
          image: order.image,
          orders: [],
          totalUnits: 0,
          dueTodayCount: 0,
          earliestPriorityAt: '',
          channels: new Set(),
        });
      }
      const group = groups.get(sku);
      group.orders.push(order);
      group.totalUnits += Number(order.totalQty || 0);
      if (order.dueToday) group.dueTodayCount++;
      group.channels.add(order.channel);
      if (!group.earliestPriorityAt || orderSortValue(order) < new Date(group.earliestPriorityAt).getTime()) {
        group.earliestPriorityAt = order.priorityAt || order.deadlineAt || '';
      }
    }
    return [...groups.values()].sort((a, b) => {
      if (state.filters?.priorityFirst !== false) {
        const at = a.earliestPriorityAt ? new Date(a.earliestPriorityAt).getTime() : Number.POSITIVE_INFINITY;
        const bt = b.earliestPriorityAt ? new Date(b.earliestPriorityAt).getTime() : Number.POSITIVE_INFINITY;
        if (at !== bt) return at - bt;
      }
      return b.orders.length - a.orders.length || a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true });
    });
  }

  function getMultipleOrders() {
    return getAvailableOrders('multiple');
  }

  function formatRemaining(iso) {
    if (!iso) return '--';
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms)) return '--';
    if (ms <= 0) return 'EXPIRADO';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2,'0');
    const mm = String(minutes).padStart(2,'0');
    const ss = String(seconds).padStart(2,'0');
    return days > 0 ? `${days}D ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  }

  function deadlineBadge(orderOrGroup) {
    const iso = orderOrGroup.earliestPriorityAt || orderOrGroup.priorityAt || orderOrGroup.deadlineAt || '';
    if (!iso) return '';
    return `<span class="kzqc-deadline ${deadlineLevel(iso)}" data-deadline="${escapeHtml(iso)}">Expira · ${escapeHtml(formatRemaining(iso))}</span>`;
  }

  function orderShortageNoticeHtml(order) {
    const short = (order?.realItems || []).filter(item => shortageQtyFor(item.sku) > 0);
    if (!short.length) return '';
    const parts = short.map(item => `${escapeHtml(item.sku)} (${shortageQtyFor(item.sku)} un.)`).join(', ');
    return `<div class="kzqc-shortage-notice">⚠ Sem estoque: ${parts} — não vai imprimir</div>`;
  }

  function findOrderById(idStr) {
    return state.orders.find(order => order.idStr === idStr) || null;
  }

  function findOrderByNumber(value) {
    const target = norm(value).toUpperCase();
    if (!target) return null;
    return state.orders.find(order => norm(order.orderNo).toUpperCase() === target) || null;
  }

  async function getPluginPuid() {
    if (state.pluginPuid) return state.pluginPuid;
    try {
      const response = await fetch('/api/home', { credentials: 'include' });
      const json = await response.json();
      const puid = Number(json?.data?.user?.puid || json?.data?.user?.id || 0);
      if (puid) state.pluginPuid = puid;
    } catch (error) {
      console.warn('[KZ Checkout] não foi possível obter PUID:', error);
    }
    return state.pluginPuid;
  }

  function pluginSend(method, params = null) {
    if (!pluginSocket || pluginSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Plugin de impressão do UpSeller desconectado.');
    }
    pluginSocket.send(JSON.stringify({ method, params }));
  }

  function parsePluginMessage(raw) {
    try { return JSON.parse(String(raw || '{}')); }
    catch { return null; }
  }

  function handlePluginPrintProcess(message) {
    const job = state.activePrintJob;
    if (!job || message?.method !== 'printProcess') return;
    const data = message.data || {};
    const successRows = Array.isArray(data.printSuccess) ? data.printSuccess : [];
    const errorRows = Array.isArray(data.printError) ? data.printError : [];

    successRows.forEach(row => {
      const id = norm(row.orderIdStr || row.orderId);
      if (job.expected.has(id)) job.success.set(id, row);
    });
    errorRows.forEach(row => {
      const id = norm(row.orderIdStr || row.orderId);
      if (job.expected.has(id)) job.errors.set(id, row);
    });

    const done = job.success.size + job.errors.size;
    setMessage(`Imprimindo pelo plugin UpSeller: ${done}/${job.expected.size}`, 'info');

    if (done >= job.expected.size) {
      clearTimeout(job.timeout);
      state.activePrintJob = null;
      job.resolve({
        ok: job.errors.size === 0,
        success: [...job.success.entries()].map(([orderId, detail]) => ({ orderId, detail })),
        errors: [...job.errors.entries()].map(([orderId, detail]) => ({ orderId, detail })),
      });
    }
  }

  function handlePluginMessage(event) {
    const message = parsePluginMessage(event.data);
    if (!message) return;
    console.log('[KZ Checkout][Plugin]', message);

    if (message.method === 'getPrinter' && message.code === 'SUCCESS') {
      state.agentOnline = true;
      state.pluginStatus = 'conectado';
      state.printers = Array.isArray(message.data) ? message.data : [];
      const current = norm(message.message);
      if (!state.printer) {
        state.printer = current || state.printers[0] || '';
        if (state.printer) localStorage.setItem(STORAGE_PRINTER, state.printer);
      }
      scheduleRender();
      return;
    }
    if (message.method === 'printProcess') handlePluginPrintProcess(message);
  }

  async function connectPrintPlugin(force = false) {
    if (!force && pluginSocket?.readyState === WebSocket.OPEN) return true;
    if (!force && pluginConnectPromise) return pluginConnectPromise;

    pluginConnectPromise = (async () => {
      clearTimeout(pluginReconnectTimer);
      try { pluginSocket?.close(); } catch {}
      state.agentOnline = false;
      state.pluginStatus = 'conectando';
      scheduleRender();
      const puid = await getPluginPuid();

      return await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { pluginSocket?.close(); } catch {}
          reject(new Error('O UpSeller Print Plugin não respondeu em 8 segundos.'));
        }, 8000);

        try {
          pluginSocket = new WebSocket(PRINT_PLUGIN_URL);
        } catch (error) {
          clearTimeout(timeout);
          settled = true;
          reject(error);
          return;
        }

        pluginSocket.addEventListener('open', () => {
          try {
            pluginSend('getPrinter', null);
            if (puid) pluginSend('setPuid', [puid]);
            setTimeout(() => {
              if (state.printer && pluginSocket?.readyState === WebSocket.OPEN) {
                pluginSend('changePrinter', [state.printer]);
              }
            }, 80);
            state.agentOnline = true;
            state.pluginStatus = 'conectado';
            scheduleRender();
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(true);
            }
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(error);
            }
          }
        });
        pluginSocket.addEventListener('message', handlePluginMessage);
        pluginSocket.addEventListener('close', () => {
          // Enquanto o plugin estiver desligado, isso tenta reconectar a cada 5s para
          // sempre — sem essa checagem, cada tentativa falha e chama scheduleRender(),
          // recriando o painel inteiro (e resetando o scroll) a cada 5s indefinidamente.
          const wasOnline = state.agentOnline;
          state.agentOnline = false;
          state.pluginStatus = 'desconectado';
          if (wasOnline) scheduleRender();
          if (!state.loading) pluginReconnectTimer = setTimeout(() => connectPrintPlugin(false).catch(() => {}), 5000);
        });
        pluginSocket.addEventListener('error', () => {
          const wasOnline = state.agentOnline;
          state.agentOnline = false;
          state.pluginStatus = 'erro';
          if (wasOnline) scheduleRender();
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error('Não foi possível conectar ao UpSeller Print Plugin em ws://localhost:21319.'));
          }
        });
      });
    })();

    try { return await pluginConnectPromise; }
    finally { pluginConnectPromise = null; }
  }

  async function refreshAgent() {
    const wasOnline = state.agentOnline;
    const wasStatus = state.pluginStatus;
    try {
      await connectPrintPlugin(true);
      if (pluginSocket?.readyState === WebSocket.OPEN) pluginSend('getPrinter', null);
    } catch (error) {
      state.agentOnline = false;
      state.pluginStatus = 'desconectado';
      console.warn('[KZ Checkout] plugin:', error);
    }
    // Roda a cada 20s (agentTimer); só re-renderiza o painel inteiro se o status
    // realmente mudou, senão vira mais uma fonte de reset de scroll periódico.
    if (state.agentOnline !== wasOnline || state.pluginStatus !== wasStatus) scheduleRender();
  }

  async function printOrdersWithPlugin(orders, timeoutMs = 60000) {
    if (!orders.length) return { ok: true, success: [], errors: [] };
    await connectPrintPlugin(false);
    if (!state.printer) throw new Error('Selecione uma impressora.');
    if (state.activePrintJob) throw new Error('Já existe uma impressão em andamento.');

    pluginSend('changePrinter', [state.printer]);
    await new Promise(resolve => setTimeout(resolve, 120));

    return await new Promise((resolve, reject) => {
      const ids = orders.map(order => norm(order.idStr)).filter(Boolean);
      const job = {
        expected: new Set(ids),
        success: new Map(),
        errors: new Map(),
        resolve,
        reject,
        timeout: null,
      };
      job.timeout = setTimeout(() => {
        if (state.activePrintJob !== job) return;
        state.activePrintJob = null;
        const unknownIds = [...job.expected].filter(id => !job.success.has(id) && !job.errors.has(id));
        addSystemLog('plugin_timeout_parcial', { confirmados: job.success.size, erros: job.errors.size, desconhecidos: unknownIds, total: job.expected.size });
        resolve({
          ok: false,
          timedOut: true,
          success: [...job.success.entries()].map(([orderId, detail]) => ({ orderId, detail })),
          errors: [...job.errors.entries()].map(([orderId, detail]) => ({ orderId, detail })),
          unknownIds,
        });
      }, timeoutMs);
      state.activePrintJob = job;
      try {
        pluginSend('printMany', [ids]);
      } catch (error) {
        clearTimeout(job.timeout);
        state.activePrintJob = null;
        reject(error);
      }
    });
  }

  async function postForm(url, params) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    let json = null;
    try { json = await response.json(); }
    catch { throw new Error(`Resposta inválida de ${url}`); }
    return { response, json };
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); }
    catch { throw new Error(`Resposta inválida de ${url}`); }
    return { response, json };
  }

  // Anular (mark=1) / Redefinir (mark=0) são o MESMO endpoint nativo do UpSeller —
  // confirmado via captura de rede real feita pelo usuário.
  async function setOrderVoided(orderId, voided) {
    const body = new URLSearchParams();
    if (voided) body.set('isBatch', '0');
    body.set('mark', voided ? '1' : '0');
    body.append('orderIdList[0]', orderId);
    const { json } = await postForm('/api/order/void-order', body);
    return json;
  }

  async function fetchOrderRelationDetail(order) {
    const platform = order?.raw?.platform || order?.channel || '';
    const { json } = await postJson('/api/sku-order/detail', { orderId: order.idStr, platform });
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao consultar a composição do pedido.');
    return Array.isArray(json?.data) ? json.data : [];
  }

  async function searchReplacementSku(searchValue, warehouseId) {
    const { json } = await postJson('/api/sku/search-sku-list', {
      warehouseId,
      pageNum: 1,
      pageSize: 50,
      searchValue,
      searchType: '1',
      searchGroup: 1,
      saleStatus: 0,
    });
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao buscar produtos.');
    return Array.isArray(json?.data?.list) ? json.data.list : [];
  }

  async function applyRelationChange(order, orderItemId, warehouseId, skuInfoList) {
    const platform = order?.raw?.platform || order?.channel || '';
    const { json } = await postJson('/api/sku-order/edit-relation', {
      orderItemId,
      warehouseId,
      orderId: order.idStr,
      platform,
      skuInfoList,
    });
    return isSuccess(json);
  }

  // Sequência completa: anula -> troca o produto -> redefine. Se a troca falhar
  // depois de anular, desanula de volta (nada muda). Se a troca funcionar mas o
  // redefinir falhar, tenta de novo algumas vezes antes de deixar um aviso fixo —
  // nunca deixa o pedido preso em "Anulado" sem avisar, mesmo mudança já aplicada.
  // changes: [{ orderItemId, warehouseId, skuInfoList }, ...] — um pedido pode ter mais
  // de um item pra trocar (kit ou múltiplos itens); cada um vira sua própria chamada de
  // edit-relation, mas o anular/redefinir acontece uma única vez pra o pedido inteiro.
  async function runProductChangeSequence(order, changes) {
    setMessage(`Anulando pedido ${order.orderNo}...`, 'info');
    let voidJson;
    try { voidJson = await setOrderVoided(order.idStr, true); }
    catch (error) { setMessage(error.message || String(error), 'error'); return false; }
    if (!isSuccess(voidJson)) {
      setMessage(voidJson?.msg || 'Falha ao anular o pedido — nada foi alterado.', 'error');
      return false;
    }

    setMessage(`Aplicando troca de produto (${changes.length} item(ns))...`, 'info');
    let applyOk = true;
    for (const change of changes) {
      try {
        const ok = await applyRelationChange(order, change.orderItemId, change.warehouseId, change.skuInfoList);
        if (!ok) { applyOk = false; break; }
      } catch { applyOk = false; break; }
    }

    if (!applyOk) {
      setMessage('Falha ao trocar o produto — desanulando o pedido para não deixar travado...', 'error');
      try { await setOrderVoided(order.idStr, false); } catch {}
      setMessage(`Troca cancelada para o pedido ${order.orderNo}. Ele foi desanulado e voltou ao estado original.`, 'error');
      requestOrdersRefresh(true);
      return false;
    }

    setMessage('Redefinindo pedido...', 'info');
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 800));
      let redefineJson;
      try { redefineJson = await setOrderVoided(order.idStr, false); } catch { redefineJson = null; }
      if (isSuccess(redefineJson)) {
        setMessage(`✓ Produto trocado e pedido ${order.orderNo} redefinido com sucesso.`, 'success');
        requestOrdersRefresh(true);
        return true;
      }
    }

    state.stuckVoidedOrders = [...(state.stuckVoidedOrders || []), { orderId: order.idStr, orderNo: order.orderNo, at: new Date().toISOString() }];
    saveJson(STORAGE_STUCK_VOIDED, state.stuckVoidedOrders);
    setMessage(`⚠ Produto do pedido ${order.orderNo} foi trocado, mas não consegui redefinir automaticamente. Veja o aviso no topo do painel.`, 'error');
    scheduleRender();
    return false;
  }

  async function generatePdfForOrder(order, progress) {
    const prepBody = new URLSearchParams();
    prepBody.append('orderIdList[0]', order.idStr);
    const prep = await postForm('/api/order/get-print-label-order', prepBody);
    console.log('[KZ Checkout] preparação', order.orderNo || order.idStr, prep.json);

    const printBody = new URLSearchParams();
    printBody.set('isCos', '1');
    printBody.set('printIdStr', order.idStr);
    printBody.set('authIdStr', order.authIdStr);
    printBody.set('isBatchPrint', '1');

    const print = await postForm('/api/print-label', printBody);
    const uuid = typeof print.json?.data === 'string'
      ? print.json.data
      : norm(print.json?.data?.uuid || print.json?.uuid);

    if (!uuid) {
      throw new Error(`O pedido ${order.orderNo || order.idStr} não retornou UUID de etiqueta.`);
    }

    for (let attempt = 1; attempt <= 25; attempt++) {
      progress(`Gerando etiqueta ${progress.current}/${progress.total} · tentativa ${attempt}`);
      await new Promise(resolve => setTimeout(resolve, 650));
      const checkResponse = await fetch('/api/check-process?uuid=' + encodeURIComponent(uuid), {
        credentials: 'include',
      });
      const checkJson = await checkResponse.json();
      let processMsg = checkJson?.data?.processMsg;
      if (typeof processMsg === 'string') {
        try { processMsg = JSON.parse(processMsg); } catch {}
      }

      if (processMsg?.code === 1 || processMsg?.code === '1') {
        const url = norm(processMsg?.msg || processMsg?.url || processMsg?.data?.url);
        if (!url) throw new Error(`A etiqueta do pedido ${order.orderNo || order.idStr} terminou sem URL.`);
        return new URL(url, location.origin).href;
      }

      if (processMsg?.code === -1 || processMsg?.code === '-1' || processMsg?.data?.failList?.length) {
        throw new Error(`Falha ao gerar a etiqueta do pedido ${order.orderNo || order.idStr}.`);
      }
    }

    throw new Error(`Tempo esgotado ao gerar a etiqueta do pedido ${order.orderNo || order.idStr}.`);
  }

  async function markOrders(orderIds) {
    const body = new URLSearchParams();
    body.set('isBatch', '0');
    body.set('mark', '1');
    body.set('markType', '0');
    orderIds.forEach((id, index) => body.append(`orderIdList[${index}]`, id));

    try {
      const batch = await postForm('/api/order/mark-print', body);
      console.log('[KZ Checkout] mark-print lote:', batch.json);
      if (isSuccess(batch.json)) return { ok: true, failedIds: [] };
    } catch (error) {
      console.warn('[KZ Checkout] mark-print lote falhou:', error);
    }

    const failedIds = [];
    for (const id of orderIds) {
      try {
        const singleBody = new URLSearchParams();
        singleBody.set('isBatch', '0');
        singleBody.set('mark', '1');
        singleBody.set('markType', '0');
        singleBody.append('orderIdList[0]', id);
        const single = await postForm('/api/order/mark-print', singleBody);
        if (!isSuccess(single.json)) failedIds.push(id);
      } catch {
        failedIds.push(id);
      }
    }
    return { ok: failedIds.length === 0, failedIds };
  }


  async function markOrdersReliably(orderIds) {
    const ids = [...new Set((orderIds || []).map(norm).filter(Boolean))];
    if (!ids.length) return { ok: true, failedIds: [] };

    let failedIds = [...ids];
    const waits = [0, 450, 1200];

    for (let attempt = 0; attempt < waits.length && failedIds.length; attempt++) {
      if (waits[attempt]) await new Promise(resolve => setTimeout(resolve, waits[attempt]));
      const result = await markOrders(failedIds);
      failedIds = [...result.failedIds];

      // Pedidos recém-criados podem responder sucesso antes de sair da fila.
      // Confirma diretamente na aba Etiqueta não impressa antes de liberar o ID.
      if (!failedIds.length) {
        await new Promise(resolve => setTimeout(resolve, 450));
        try {
          const stillUnprinted = new Set((await fetchAllUnprintedOrders())
            .map(order => norm(order?.idStr || order?.id))
            .filter(Boolean));
          failedIds = ids.filter(id => stillUnprinted.has(id));
        } catch (error) {
          console.warn('[KZ Checkout] não foi possível confirmar a saída da fila:', error);
          failedIds = [];
        }
      }
    }

    return { ok: failedIds.length === 0, failedIds };
  }

  function makeJobId(label, orders) {
    const compact = orders.map(order => order.idStr).join('-').replace(/\D/g, '').slice(-30);
    const safe = norm(label || 'PEDIDO').replace(/[^A-Z0-9_-]/gi, '').slice(0, 30) || 'PEDIDO';
    return `KZ-${Date.now()}-${safe}-${compact}`;
  }

  function addPrintHistory(entry) {
    const history = Array.isArray(state.printHistory) ? state.printHistory : [];
    history.unshift(entry);
    state.printHistory = history.slice(0, 100);
    saveJson(STORAGE_PRINT_HISTORY, state.printHistory);
  }

  async function reprintHistoryEntry(historyId) {
    if (state.loading) return;
    const entry = (state.printHistory || []).find(row => row.id === historyId);
    if (!entry) return setMessage('Pedido não encontrado no histórico.', 'error');
    if (!state.agentOnline || !state.printer) return setMessage('Conecte o UpSeller Print Plugin e selecione a impressora.', 'error');
    if (!confirm(`Reimprimir somente o pedido ${entry.orderNo || entry.orderId}?

Isso NÃO chama mark-print novamente.`)) return;

    state.loading = true;
    setMessage(`Reimprimindo ${entry.orderNo || entry.orderId}...`, 'info');
    scheduleRender();
    try {
      const order = {
        idStr: entry.orderId,
        orderNo: entry.orderNo,
        authIdStr: entry.authIdStr,
        trackingNumber: entry.trackingNumber,
      };
      const result = await printOrdersWithPlugin([order]);
      if (!result.success.length) throw new Error(result.errors[0]?.detail?.errorMsg || 'O plugin não confirmou a reimpressão.');
      entry.reprints = Number(entry.reprints || 0) + 1;
      entry.lastReprintedAt = new Date().toISOString();
      saveJson(STORAGE_PRINT_HISTORY, state.printHistory);
      setMessage(`✓ Pedido ${entry.orderNo || entry.orderId} reimpresso.`, 'success');
      closeHistoryModal();
      showHistoryModal();
    } catch (error) {
      console.error('[KZ Checkout] reimpressão:', error);
      setMessage(error.message || String(error), 'error');
    } finally {
      state.loading = false;
      scheduleRender();
    }
  }

  function closeHistoryModal() {
    document.getElementById('kzqc-history-modal')?.remove();
  }

  function showHistoryModal() {
    closeHistoryModal();
    const rows = Array.isArray(state.printHistory) ? state.printHistory : [];
    const modal = document.createElement('div');
    modal.id = 'kzqc-history-modal';
    const fmt = value => {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? String(value || '') : d.toLocaleString('pt-BR');
    };
    modal.innerHTML = `
      <div class="kzqc-history-card">
        <div class="kzqc-history-head">
          <div><b>Últimas etiquetas impressas</b><div>Reimpressão individual por pedido</div></div>
          <button id="kzqc-history-close">×</button>
        </div>
        <div class="kzqc-history-list">
          ${rows.length ? rows.map(row => `
            <div class="kzqc-history-row">
              ${row.image ? `<img src="${escapeHtml(row.image)}" alt="">` : '<div class="kzqc-history-placeholder"></div>'}
              <div class="kzqc-history-info">
                <div class="kzqc-history-sku">${escapeHtml(row.orderNo || row.orderId)}</div>
                <div><b>${escapeHtml(row.sku || '')}</b> · ${escapeHtml(row.title || '')}</div>
                <div>${fmt(row.at)} · posição ${Number(row.batchIndex || 1)}/${Number(row.batchTotal || 1)} · ${escapeHtml(row.printer || '')}</div>
                <div>${escapeHtml(row.trackingNumber || '')}</div>
                ${row.reprints ? `<div class="kzqc-reprint-count">Reimpressa ${row.reprints} vez(es)</div>` : ''}
              </div>
              <button class="kzqc-history-reprint" data-history-id="${escapeHtml(row.id)}">Imprimir este pedido</button>
            </div>`).join('') : '<div class="kzqc-empty">Nenhuma etiqueta registrada neste navegador.</div>'}
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-history-close').onclick = closeHistoryModal;
    modal.addEventListener('click', event => { if (event.target === modal) closeHistoryModal(); });
    modal.querySelectorAll('.kzqc-history-reprint').forEach(button => {
      button.onclick = () => reprintHistoryEntry(button.dataset.historyId);
    });
  }

  async function executePrint(group, qty) {
    if (state.loading) return false;
    if (!state.agentOnline) {
      setMessage('O UpSeller Print Plugin não está conectado.', 'error');
      return false;
    }
    if (!state.printer) {
      setMessage('Selecione uma impressora.', 'error');
      return false;
    }

    const selectedOrders = group.orders.slice(0, qty);
    const displayLabel = group.label || group.sku || selectedOrders[0]?.orderNo || 'pedido';
    state.loading = true;
    setMessage(`Enviando ${selectedOrders.length} etiqueta(s) ao plugin oficial...`, 'info');
    scheduleRender();

    try {
      const printResult = await printOrdersWithPlugin(selectedOrders);
      const successIds = printResult.success.map(row => row.orderId);
      const failedIds = printResult.errors.map(row => row.orderId);
      const unknownIds = Array.isArray(printResult.unknownIds) ? printResult.unknownIds.map(norm).filter(Boolean) : [];
      const successSet = new Set(successIds);
      const now = new Date().toISOString();

      const successfulOrders = selectedOrders.filter(order => successSet.has(norm(order.idStr)));
      successfulOrders.forEach((order, index) => {
        const detail = printResult.success.find(row => row.orderId === norm(order.idStr))?.detail || {};
        addPrintHistory({
          id: `HIST-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          orderId: order.idStr,
          orderNo: order.orderNo,
          authIdStr: order.authIdStr,
          trackingNumber: detail.trackingNo || order.trackingNumber || '',
          sku: group.sku || order.realItems?.[0]?.sku || displayLabel,
          title: group.title || order.title || '',
          image: group.image || order.image || '',
          printer: state.printer,
          batchIndex: Number(detail.index || index + 1),
          batchTotal: selectedOrders.length,
          at: now,
          reprints: 0,
        });
      });

      if (successfulOrders.length) {
        const last = successfulOrders[successfulOrders.length - 1];
        state.lastPrinted = {
          sku: group.sku || last.realItems?.[0]?.sku || displayLabel,
          title: group.title || last.title || '',
          image: group.image || last.image || '',
          quantity: successfulOrders.reduce((sum, order) => sum + Number(order.totalQty || 1), 0),
          labels: successfulOrders.length,
          orderNos: successfulOrders.map(order => order.orderNo || order.idStr),
          at: now,
        };
        saveJson(STORAGE_LAST_PRINTED, state.lastPrinted);
      }

      if (unknownIds.length) {
        const unknownOrders = selectedOrders.filter(order => unknownIds.includes(norm(order.idStr)));
        state.unknownPrint = {
          sku: displayLabel,
          printer: state.printer,
          orderIds: [...unknownIds],
          orderNos: unknownOrders.map(order => order.orderNo || order.idStr),
          createdAt: now,
        };
        saveJson(STORAGE_UNKNOWN_PRINT, state.unknownPrint);
        const unknownSet = new Set(unknownIds);
        state.orders = state.orders.filter(order => !unknownSet.has(norm(order.idStr)));
        addSystemLog('impressao_resultado_desconhecido', { sku: displayLabel, pedidos: state.unknownPrint.orderNos, ids: unknownIds });
        scheduleRender();
      }

      if (successIds.length) {
        state.pending = {
          sku: displayLabel,
          printer: state.printer,
          orderIds: [...successIds],
          createdAt: now,
        };
        saveJson(STORAGE_PENDING, state.pending);
        // Assim que o plugin confirma a impressão, o pedido sai localmente da fila.
        // Isso evita imprimir duas vezes enquanto o UpSeller ainda processa a marcação.
        const printedSet = new Set(successIds.map(norm));
        state.orders = state.orders.filter(order => !printedSet.has(norm(order.idStr)));
        scheduleRender();

        setMessage(`Plugin confirmou ${successIds.length}/${selectedOrders.length}. Confirmando a marcação no UpSeller...`, 'info');
        const marked = await markOrdersReliably(successIds);
        const markedIds = successIds.filter(id => !marked.failedIds.includes(id));
        if (marked.ok) {
          state.pending = null;
          localStorage.removeItem(STORAGE_PENDING);
        } else {
          state.pending.orderIds = marked.failedIds;
          saveJson(STORAGE_PENDING, state.pending);
        }
      }

      if (unknownIds.length) {
        setMessage(`⚠ ${unknownIds.length} etiqueta(s) sem confirmação do plugin. O campo foi liberado, mas esses pedidos ficaram bloqueados para evitar duplicidade. Confira a impressora.`, 'error');
      } else if (failedIds.length) {
        const failedOrders = selectedOrders.filter(order => failedIds.includes(norm(order.idStr))).map(order => order.orderNo || order.idStr);
        setMessage(`✓ ${successIds.length} impressa(s). ✗ ${failedIds.length} falhou(aram): ${failedOrders.join(', ')}. Use a lista para tentar novamente.`, 'error');
      } else if (state.pending?.orderIds?.length) {
        setMessage(`As ${successIds.length} etiquetas saíram, mas ${state.pending.orderIds.length} marcação(ões) ficaram pendentes.`, 'error');
      } else {
        setMessage(`✓ ${successIds.length} etiqueta(s) impressa(s) e marcada(s).`, 'success');
      }

      postBridge('REFRESH_ORDER_INDEX');
      return successIds.length > 0;
    } catch (error) {
      console.error('[KZ Checkout] impressão:', error);
      const isTimeout = /Tempo esgotado/i.test(error?.message || '');
      if (isTimeout) {
        // Não sabemos se a etiqueta chegou a sair fisicamente — mantém o marcador de
        // "impressão em andamento" para avisar caso a página seja recarregada agora.
        setMessage(`${error.message || String(error)} Confira a impressora antes de tentar de novo — não recarregue a página sem verificar se a etiqueta já saiu.`, 'error');
      } else {
          setMessage(error.message || String(error), 'error');
      }
      return false;
    } finally {
      state.loading = false;
      scheduleRender();
      setTimeout(focusScanner, 40);
    }
  }

  async function resolveUnknownPrint(action) {
    if (!state.unknownPrint?.orderIds?.length || state.loading) return;
    const ids = [...state.unknownPrint.orderIds];
    if (action === 'mark') {
      state.loading = true;
      setMessage(`Marcando ${ids.length} pedido(s) verificado(s) como impressos...`, 'info');
      scheduleRender();
      try {
        const result = await markOrdersReliably(ids);
        if (result.ok) {
          state.unknownPrint = null;
          localStorage.removeItem(STORAGE_UNKNOWN_PRINT);
          setMessage('✓ Pedidos verificados e marcados como impressos.', 'success');
        } else {
          state.unknownPrint.orderIds = result.failedIds;
          saveJson(STORAGE_UNKNOWN_PRINT, state.unknownPrint);
          setMessage(`Ainda restam ${result.failedIds.length} pedido(s) sem marcação.`, 'error');
        }
        postBridge('REFRESH_ORDER_INDEX');
      } catch (error) {
        setMessage(error.message || String(error), 'error');
      } finally {
        state.loading = false;
        scheduleRender();
        setTimeout(focusScanner, 40);
      }
      return;
    }
    if (action === 'release') {
      state.unknownPrint = null;
      localStorage.removeItem(STORAGE_UNKNOWN_PRINT);
      setMessage('Pedidos liberados para nova impressão. Use somente após confirmar que nenhuma etiqueta saiu.', 'info');
      requestOrdersRefresh(true);
    }
  }

  async function retryStuckVoided() {
    if (!state.stuckVoidedOrders?.length || state.loading) return;
    state.loading = true;
    scheduleRender();
    const remaining = [];
    for (const entry of state.stuckVoidedOrders) {
      setMessage(`Tentando redefinir o pedido ${entry.orderNo}...`, 'info');
      try {
        const json = await setOrderVoided(entry.orderId, false);
        if (!isSuccess(json)) remaining.push(entry);
      } catch { remaining.push(entry); }
    }
    state.stuckVoidedOrders = remaining;
    saveJson(STORAGE_STUCK_VOIDED, remaining);
    state.loading = false;
    setMessage(remaining.length ? `Ainda restam ${remaining.length} pedido(s) presos em Anulado.` : '✓ Todos os pedidos foram redefinidos.', remaining.length ? 'error' : 'success');
    requestOrdersRefresh(true);
    scheduleRender();
  }

  async function retryPendingMark() {
    if (!state.pending?.orderIds?.length || state.loading) return;
    state.loading = true;
    setMessage(`Tentando marcar ${state.pending.orderIds.length} pedido(s) novamente...`, 'info');
    try {
      const ids = [...state.pending.orderIds];
      const result = await markOrdersReliably(ids);
      const successful = ids.filter(id => !result.failedIds.includes(id));
      if (successful.length) {
        const successfulSet = new Set(successful);
        state.orders = state.orders.filter(order => !successfulSet.has(order.idStr));
      }
      if (result.ok) {
        state.pending = null;
        localStorage.removeItem(STORAGE_PENDING);
        setMessage('✓ Pedidos pendentes marcados como impressos.', 'success');
      } else {
        state.pending.orderIds = result.failedIds;
        saveJson(STORAGE_PENDING, state.pending);
        setMessage(`Ainda restam ${result.failedIds.length} marcação(ões) pendente(s).`, 'error');
      }
      postBridge('REFRESH_ORDER_INDEX');
    } catch (error) {
      setMessage(error.message || String(error), 'error');
    } finally {
      state.loading = false;
      scheduleRender();
    }
  }

  // Botão manual pra destravar pedidos presos em "aguardando marcação" ou "impressão
  // em andamento" sem precisar esperar o retry automático — usa quando um pedido some
  // da lista sem motivo aparente, pra garantir que não é um bloqueio antigo escondendo ele.
  function clearAllPrintBlocks() {
    const hadPending = Boolean(state.pending?.orderIds?.length || state.unknownPrint?.orderIds?.length);
    state.pending = null;
    state.unknownPrint = null;
    localStorage.removeItem(STORAGE_PENDING);
    localStorage.removeItem(STORAGE_UNKNOWN_PRINT);
    if (hadPending) {
      setMessage('Bloqueios de impressão limpos. Atualizando pedidos...', 'success');
    } else {
      setMessage('Nenhum bloqueio de impressão estava ativo. Atualizando pedidos...', 'info');
    }
    requestOrdersRefresh(true);
  }

  function ordersWithCustomerMessage(orders) {
    return (orders || []).filter(order => norm(order?.msgContent || order?.raw?.msgContent));
  }

  function confirmCustomerMessages(orders) {
    const flagged = ordersWithCustomerMessage(orders);
    if (!flagged.length) return Promise.resolve(true);
    document.getElementById('kzqc-modal')?.remove();
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.id = 'kzqc-modal';
      modal.innerHTML = `<div class="kzqc-modal-card kzqc-modal-wide"><div class="kzqc-modal-title">ATENÇÃO — MENSAGEM DO CLIENTE</div><div class="kzqc-modal-subtitle">${flagged.length} pedido(s) possuem instruções do cliente. Confira antes de imprimir.</div><div class="kzqc-bulk-components">${flagged.map(order=>`<div class="kzqc-bulk-row"><span class="kzqc-bulk-row-copy"><b>${escapeHtml(order.orderNo||order.idStr)}</b><small>${escapeHtml(order.msgContent||order.raw?.msgContent||'')}</small></span></div>`).join('')}</div><div class="kzqc-modal-actions"><button id="kzqc-msg-cancel" class="secondary">Cancelar impressão</button><button id="kzqc-msg-confirm" class="primary">Li a mensagem e desejo continuar</button></div></div>`;
      document.body.appendChild(modal);
      modal.querySelector('#kzqc-msg-cancel').onclick=()=>{modal.remove();resolve(false)};
      modal.querySelector('#kzqc-msg-confirm').onclick=()=>{modal.remove();resolve(true)};
    });
  }

  function buildCheckoutSession(order) {
    return {
      orderId: order.idStr,
      orderIds: [order.idStr],
      orderNo: order.orderNo,
      orderNos: [order.orderNo || order.idStr],
      ordersCount: 1,
      category: order.category,
      required: order.realItems.map(item => ({ sku:item.sku,title:item.title,image:item.image,scanAliases:mergeScanAliases(item.sku,item.scanAliases||[]),qty:Number(item.qty||0),scanned:0 })),
      status: 'scanning',
    };
  }

  async function startBulkCheckout(orders) {
    const first=orders[0]; if (!first) return;
    if (!(await confirmCustomerMessages(orders))) { setMessage('Impressão cancelada para conferência da mensagem do cliente.','warn'); return; }
    const count=orders.length;
    state.checkoutSession={
      orderId:first.idStr, orderIds:orders.map(o=>o.idStr), orderNo:first.orderNo,
      orderNos:orders.map(o=>o.orderNo||o.idStr), ordersCount:count, category:'multiple',
      required:(first.realItems||[]).map(item=>({sku:item.sku,title:item.title,image:item.image,scanAliases:mergeScanAliases(item.sku,item.scanAliases||[]),qty:Number(item.qty||0)*count,scanned:0})), status:'scanning'
    };
    state.activeTab='multiple'; saveJson(STORAGE_UI,{minimized:state.minimized,activeTab:state.activeTab});
    setMessage(`Checkout em massa aberto: ${count} pedidos iguais.`, 'info'); renderPanel(); setTimeout(focusScanner,50);
  }

  // Modo "conferir bipando" pro Item Único (=1): em vez de confiar cegamente na
  // quantidade digitada no modal, exige bipar o SKU físico uma vez pra cada pedido
  // antes de liberar a impressão em massa — reaproveita o mesmo mecanismo de sessão
  // (state.checkoutSession) já usado em Item Único (>1) e Múltiplos Itens, então
  // ganha de graça a barra de progresso, o beep de erro e a mensagem vermelha em
  // caso de bipagem errada (scanCheckoutItem já faz tudo isso).
  async function startQuantityScanSession(group, qty) {
    const orders = group.orders.slice(0, qty);
    if (!orders.length) return;
    if (!(await confirmCustomerMessages(orders))) { setMessage('Impressão cancelada para conferência da mensagem do cliente.','warn'); return; }
    state.checkoutSession = {
      orderId: orders[0].idStr, orderIds: orders.map(o=>o.idStr), orderNo: orders[0].orderNo,
      orderNos: orders.map(o=>o.orderNo||o.idStr), ordersCount: orders.length, category: 'single1',
      required: [{ sku: group.sku, title: group.title, image: group.image, scanAliases: mergeScanAliases(group.sku, orders[0].realItems?.[0]?.scanAliases||[]), qty: orders.length, scanned: 0 }],
      status: 'scanning',
    };
    state.activeTab='single1'; saveJson(STORAGE_UI,{minimized:state.minimized,activeTab:state.activeTab});
    setMessage(`Bipe o SKU ${group.sku} ${orders.length} vez(es) para liberar a impressão.`, 'info'); renderPanel(); setTimeout(focusScanner,50);
  }

  function checkoutProgress(session = state.checkoutSession) {
    const total = (session?.required || []).reduce((sum, item) => sum + item.qty, 0);
    const scanned = (session?.required || []).reduce((sum, item) => sum + item.scanned, 0);
    return { total, scanned, complete: total > 0 && scanned >= total };
  }

  async function startCheckout(order, firstSku = '') {
    if (!(await confirmCustomerMessages([order]))) { setMessage('Impressão cancelada para conferência da mensagem do cliente.','warn'); return; }
    state.checkoutSession = buildCheckoutSession(order);
    state.activeTab = order.category;
    saveJson(STORAGE_UI, { minimized: state.minimized, activeTab: state.activeTab });
    setMessage(`Checkout aberto para ${order.orderNo || order.idStr}. Continue bipando os itens.`, 'info');
    scheduleRender();
    if (firstSku) setTimeout(() => scanCheckoutItem(firstSku), 30);
    else setTimeout(focusScanner, 60);
  }

  function cancelCheckout() {
    state.checkoutSession = null;
    setMessage('Checkout cancelado. Nenhuma etiqueta foi impressa.', 'warn');
    scheduleRender();
    setTimeout(focusScanner, 40);
  }

  async function finishCheckout() {
    const session = state.checkoutSession;
    if (!session || session.status === 'printing') return;
    const progress = checkoutProgress(session);
    if (!progress.complete) return;
    const orders = (session.orderIds || [session.orderId]).map(findOrderById).filter(Boolean);
    if (!orders.length) {
      setMessage('Os pedidos do checkout não estão mais disponíveis.', 'error');
      state.checkoutSession = null; scheduleRender(); return;
    }
    session.status = 'printing'; scheduleRender();
    const first=orders[0];
    const ok = await executePrint({ label: session.ordersCount > 1 ? `${session.ordersCount} pedidos iguais` : (first.orderNo || first.idStr), sku:first.sku || first.realItems?.[0]?.sku || 'PEDIDO', orders }, orders.length);
    if (ok) {
      state.checkoutSession = null;
    } else if (state.checkoutSession) {
      state.checkoutSession.status = 'scanning';
    }
    scheduleRender();
  }

  // Só faz sentido pra sessão de "conferir bipando" do Item Único (=1): como todos
  // os pedidos precisam da mesma quantidade (1 un.) do mesmo SKU, são intercambiáveis
  // — os N já bipados podem ser qualquer N da lista, não importa qual exatamente. Os
  // pedidos que não foram bipados nunca saem de state.orders durante a sessão, então
  // ao fechar a sessão eles reaparecem sozinhos na lista da aba (comportamento igual
  // a "voltar pra fila").
  async function printOnlyScanned() {
    const session = state.checkoutSession;
    if (!session || session.status === 'printing') return;
    const item = session.required?.[0];
    const scannedCount = Number(item?.scanned || 0);
    if (!scannedCount) { setMessage('Nenhuma unidade foi bipada ainda.', 'error'); return; }
    const orders = (session.orderIds || []).map(findOrderById).filter(Boolean).slice(0, scannedCount);
    if (!orders.length) {
      setMessage('Os pedidos bipados não estão mais disponíveis.', 'error');
      state.checkoutSession = null; scheduleRender(); return;
    }
    const missing = session.ordersCount - orders.length;
    session.status = 'printing'; scheduleRender();
    const ok = await executePrint({ label: `${orders.length} pedido(s) confirmados`, sku: item.sku, orders }, orders.length);
    if (ok) {
      setMessage(`✓ ${orders.length} etiqueta(s) impressa(s). ${missing > 0 ? `${missing} pedido(s) sem bipar voltaram para a fila.` : ''}`, 'success');
      state.checkoutSession = null;
    } else if (state.checkoutSession) {
      state.checkoutSession.status = 'scanning';
    }
    scheduleRender();
  }

  function scanCheckoutItem(value) {
    const session = state.checkoutSession;
    if (!session || session.status !== 'scanning') return;
    const scannedCode = normalizeScanCode(value);
    if (!scannedCode) return;
    const item = session.required.find(row => itemMatchesScan(row, scannedCode));
    const sku = item?.sku || scannedCode;
    if (!item) {
      beep(false);
      setMessage(`SKU ${sku} não pertence ao pedido ${session.orderNo}.`, 'error');
      scheduleRender();
      setTimeout(focusScanner, 40);
      return;
    }
    if (item.scanned >= item.qty) {
      beep(false);
      setMessage(`O SKU ${sku} já atingiu ${item.qty}/${item.qty} neste pedido.`, 'error');
      scheduleRender();
      setTimeout(focusScanner, 40);
      return;
    }
    item.scanned++;
    beep(true);
    const progress = checkoutProgress(session);
    setMessage(`Leitura confirmada: ${sku} · ${progress.scanned}/${progress.total}.`, 'success');
    scheduleRender();
    if (progress.complete) {
      setMessage(`Pedido ${session.orderNo} completo. Enviando a etiqueta para impressão...`, 'success');
      setTimeout(finishCheckout, 250);
    } else {
      setTimeout(focusScanner, 40);
    }
  }

  function findSingleManyOrderBySku(value) {
    return getAvailableOrders('singleMany').find(order =>
      itemMatchesScan(order.realItems?.[0] || { sku: order.sku }, value)
    ) || null;
  }

  function findMultipleOrderBySku(value) {
    return getAvailableOrders('multiple').find(order =>
      order.realItems.some(item => itemMatchesScan(item, value))
    ) || null;
  }

  function showQuantityModal(group, shortageQty = 0) {
    document.getElementById('kzqc-modal')?.remove();
    const max = group.orders.length;
    const modal = document.createElement('div');
    modal.id = 'kzqc-modal';
    modal.innerHTML = `
      <div class="kzqc-modal-card">
        <div class="kzqc-modal-title">SKU ${escapeHtml(group.sku)}</div>
        <div class="kzqc-modal-product">${group.image?`<img src="${escapeHtml(group.image)}" alt="${escapeHtml(group.title||group.sku)}">`:'<span class="kzqc-modal-product-placeholder"></span>'}<div><b title="${escapeHtml(group.title||'')}">${escapeHtml(group.title||'Produto sem nome')}</b><small>${max} pedido(s) de Item Único (quant. = 1)</small></div></div>
        ${shortageQty>0?`<div class="kzqc-message warn">Quantidade reduzida automaticamente: ${shortageQty} un. desse SKU marcada(s) sem estoque.</div>`:''}
        <label class="kzqc-label" for="kzqc-modal-qty">Quantidade para imprimir</label>
        <div class="kzqc-qty-row">
          <button id="kzqc-minus" type="button">−</button>
          <input id="kzqc-modal-qty" type="number" min="1" max="${max}" value="${max}">
          <button id="kzqc-plus" type="button">+</button>
        </div>
        ${switchToggleHtml('kzqc-qty-scan-toggle', state.qtyScanConfirmEnabled, 'Conferir bipando antes de imprimir', 'Quando ativado, exige bipar o SKU físico uma vez pra cada etiqueta antes de liberar a impressão em massa.')}
        <div class="kzqc-modal-actions">
          <button id="kzqc-abnormal-selected" class="danger" type="button">Anormal</button>
          <button id="kzqc-cancel" class="secondary" type="button">Cancelar</button>
          <button id="kzqc-print" class="primary" type="button">Imprimir</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const input = modal.querySelector('#kzqc-modal-qty');
    const clamp = value => Math.max(1, Math.min(max, parseInt(value || '1', 10) || 1));
    modal.querySelector('#kzqc-minus').onclick = () => { input.value = clamp(Number(input.value) - 1); };
    modal.querySelector('#kzqc-plus').onclick = () => { input.value = clamp(Number(input.value) + 1); };
    modal.querySelector('#kzqc-qty-scan-toggle').onchange = event => { state.qtyScanConfirmEnabled = event.target.checked; saveJson(STORAGE_QTY_SCAN_CONFIRM, state.qtyScanConfirmEnabled); };
    modal.querySelector('#kzqc-abnormal-selected').onclick = () => { const qty = clamp(input.value); modal.remove(); markOrdersAbnormal(group.orders.slice(0, qty)); focusScanner(); };
    modal.querySelector('#kzqc-cancel').onclick = () => { modal.remove(); focusScanner(); };
    modal.querySelector('#kzqc-print').onclick = () => {
      const qty = clamp(input.value);
      modal.remove();
      if (state.qtyScanConfirmEnabled && qty > 1) startQuantityScanSession(group, qty);
      else executePrint(group, qty);
    };
    modal.addEventListener('click', event => {
      if (event.target === modal) {
        modal.remove();
        focusScanner();
      }
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') modal.querySelector('#kzqc-print').click();
      if (event.key === 'Escape') modal.querySelector('#kzqc-cancel').click();
    });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  async function handleScan(value) {
    const input = document.getElementById('kzqc-scanner');
    const shortageMatch = String(value == null ? '' : value).trim().match(/^-\s*([^\s*]+)\s*\*\s*(\d+)\s*$/);
    if (shortageMatch) {
      if (input) input.value = '';
      const sku = normSku(shortageMatch[1]);
      const qty = Math.max(1, parseInt(shortageMatch[2], 10) || 0);
      if (!sku || !qty) {
        setMessage('Formato inválido. Use -SKU*quantidade, ex.: -14947*3.', 'error');
        beep(false); focusScanner(); return;
      }
      addStockShortage(sku, qty);
      setMessage(`${qty} unidade(s) de ${sku} marcada(s) sem estoque. Total sem estoque desse SKU: ${shortageQtyFor(sku)}.`, 'warn');
      beep(true);
      scheduleRender();
      setTimeout(focusScanner, 40);
      return;
    }

    const rawCode = normalizeScanCode(value);
    if (input) input.value = '';
    if (!rawCode) return;

    setMessage(`Localizando ${rawCode}...`, 'info');
    const scannedCode = await resolveScanToSku(rawCode);
    if (scannedCode !== rawCode) {
      setMessage(`Código ${rawCode} identificado como SKU ${scannedCode}.`, 'success');
    }

    if (state.checkoutSession) {
      scanCheckoutItem(scannedCode);
      return;
    }

    // Digitar/escanear o número do pedido (ex.: UPY71190157) abre a separação
    // daquele pedido específico direto, independente de ser kit, item único ou
    // múltiplas unidades, e independente da aba ativa no momento.
    const orderByNumber = findOrderByNumber(rawCode);
    if (orderByNumber) {
      if (!orderByNumber.realItems?.length) {
        setMessage(`Pedido ${orderByNumber.orderNo} encontrado, mas a composição não pôde ser analisada — separe manualmente pelo site do UpSeller.`, 'error');
        beep(false);
        focusScanner();
        return;
      }
      beep(true);
      if (orderByNumber.category && orderByNumber.category !== 'unknown') state.activeTab = orderByNumber.category;
      startCheckout(orderByNumber);
      return;
    }

    if (state.activeTab === 'single1') {
      const group = groupOrdersBySku('single1').find(row =>
        row.orders.some(order => itemMatchesScan(order.realItems?.[0] || { sku: row.sku }, scannedCode))
      );
      const sku = group?.sku || scannedCode;
      if (!group) {
        setMessage(`SKU ${sku} não possui pedido Item Único (quant. = 1) disponível.`, 'error');
        beep(false);
        focusScanner();
        return;
      }
      beep(true);
      const shortage = shortageQtyFor(sku);
      const printable = Math.max(0, group.orders.length - shortage);
      if (shortage > 0 && printable <= 0) {
        setMessage(`Todos os ${group.orders.length} pedido(s) do SKU ${sku} estão sem estoque (${shortage} un. faltando). Ajuste em "Produtos sem estoque".`, 'error');
        focusScanner();
        return;
      }
      const printableGroup = shortage > 0 ? { ...group, orders: group.orders.slice(0, printable) } : group;
      if (printableGroup.orders.length === 1 && shortage === 0) {
        setMessage(`SKU ${sku} encontrado em 1 pedido. Imprimindo diretamente...`, 'success');
        executePrint(printableGroup, 1);
      } else {
        showQuantityModal(printableGroup, shortage);
      }
      return;
    }

    if (state.activeTab === 'singleMany') {
      const order = findSingleManyOrderBySku(scannedCode);
      const sku = order?.sku || order?.realItems?.[0]?.sku || scannedCode;
      if (!order) {
        setMessage(`SKU ${sku} não possui pedido Item Único (quant. > 1) disponível.`, 'error');
        beep(false);
        focusScanner();
        return;
      }
      startCheckout(order, sku);
      return;
    }

    const order = findMultipleOrderBySku(scannedCode);
    const matchedItem = order?.realItems?.find(item => itemMatchesScan(item, scannedCode));
    const sku = matchedItem?.sku || scannedCode;
    if (!order) {
      setMessage(`SKU ${sku} não pertence a nenhum pedido de Múltiplos Itens disponível.`, 'error');
      beep(false);
      focusScanner();
      return;
    }
    const signature = multipleSignature(order);
    const massGroup = groupMultipleOrders().find(g => g.signature === signature && g.orders.some(o => o.idStr === order.idStr));
    if (state.bulkMassPrintEnabled && massGroup && massGroup.orders.length >= 2) {
      beep(true);
      showMultipleMassModal(massGroup);
      return;
    }
    startCheckout(order, sku);
  }

  function showSeparationOrderModal() {
    document.getElementById('kzqc-order-modal')?.remove();
    let rows = [];
    if (state.activeTab === 'single1') {
      rows = groupOrdersBySku('single1').map(group => `${group.orders.length} × ${group.sku} — ${group.title || ''}`);
    } else if (state.activeTab === 'singleMany') {
      rows = groupOrdersBySku('singleMany').map(group => `${group.totalUnits} un · ${group.orders.length} pedido(s) — ${group.sku} — ${group.title || ''}`);
    } else {
      rows = getMultipleOrders().map(order => `${order.orderNo || order.idStr}: ${order.realItems.map(item => `${item.qty}× ${item.sku}`).join(' + ')}`);
    }
    const modal = document.createElement('div');
    modal.id = 'kzqc-order-modal';
    modal.innerHTML = `
      <div class="kzqc-modal-card kzqc-order-card">
        <div class="kzqc-modal-title">Ordem rápida de separação</div>
        <div class="kzqc-modal-subtitle">Lista baseada na aba e nos filtros atualmente selecionados.</div>
        <textarea id="kzqc-order-text" readonly>${escapeHtml(rows.join('\n'))}</textarea>
        <div class="kzqc-modal-actions">
          <button id="kzqc-order-close" class="secondary">Fechar</button>
          <button id="kzqc-order-copy" class="primary">Copiar lista</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kzqc-order-close').onclick = () => modal.remove();
    modal.querySelector('#kzqc-order-copy').onclick = async () => {
      const text = rows.join('\n');
      try { await navigator.clipboard.writeText(text); setMessage('Ordem de separação copiada.', 'success'); }
      catch { modal.querySelector('#kzqc-order-text').select(); document.execCommand('copy'); }
      modal.remove();
    };
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
  }

  function beep(success) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);

      if (success) {
        // Volume no máximo possível via Web Audio (gain acima de 1 = ganho real,
        // não só "menos silencioso") — pedido explícito do usuário pra ficar mais
        // alto que até o alarme de erro. 3 camadas de tom em vez de 2 pra somar
        // mais amplitude percebida, não só subir o gain de cada oscilador sozinho.
        master.gain.setValueAtTime(3, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
        [[880, 'sine', 1], [1320, 'square', 0.85], [1760, 'triangle', 0.7]].forEach(([freq, type, gainValue], index) => {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = freq;
          const gain = ctx.createGain();
          gain.gain.value = gainValue;
          osc.connect(gain); gain.connect(master);
          osc.start(ctx.currentTime + index * 0.03);
          osc.stop(ctx.currentTime + 0.26);
        });
        setTimeout(() => ctx.close().catch(() => {}), 500);
        return;
      }

      // Alarme de erro: o apito antigo (1 tom grave só, 0.36s) era baixo demais
      // pra ouvir no chão da operação. Agora são 3 apitos agudos em sequência,
      // volume no máximo, tipo alarme — junto com o flash vermelho na tela.
      const pulseCount = 3;
      const pulseDuration = 0.16;
      const gap = 0.09;
      master.gain.setValueAtTime(1, ctx.currentTime);
      for (let i = 0; i < pulseCount; i++) {
        const start = ctx.currentTime + i * (pulseDuration + gap);
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1000, start);
        osc.frequency.exponentialRampToValueAtTime(700, start + pulseDuration);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(1, start + 0.015);
        gain.gain.setValueAtTime(1, start + pulseDuration - 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + pulseDuration);
        osc.connect(gain); gain.connect(master);
        osc.start(start);
        osc.stop(start + pulseDuration + 0.01);
      }
      const totalDuration = pulseCount * (pulseDuration + gap);
      setTimeout(() => ctx.close().catch(() => {}), (totalDuration + 0.3) * 1000);
      flashErrorAlert();
    } catch {}
  }

  function flashErrorAlert() {
    try {
      document.getElementById('kzqc-error-flash')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'kzqc-error-flash';
      (document.body || document.documentElement).appendChild(overlay);
      setTimeout(() => overlay.remove(), 750);
    } catch {}
  }

  function focusScanner() {
    if (state.minimized || state.loading || document.getElementById('kzqc-modal')) return;
    const input = document.getElementById('kzqc-scanner');
    if (input && document.activeElement !== input) input.focus();
  }

  function installStyles() {
    if (document.getElementById('kzqc-style')) return;
    const style = document.createElement('style');
    style.id = 'kzqc-style';
    style.textContent = `
      #kzqc-panel, #kzqc-panel * { box-sizing:border-box; }
      body.kzqc-abnormal-disabled #kzqc-abnormal-button,
      body.kzqc-abnormal-disabled #kzqc-session-abnormal,
      body.kzqc-abnormal-disabled #kzqc-order-abnormal,
      body.kzqc-abnormal-disabled #kzqc-abnormal-confirm,
      body.kzqc-abnormal-disabled #kzqc-abnormal-all,
      body.kzqc-abnormal-disabled #kzqc-abnormal-selected { display:none!important; }
      body.kzqc-abnormal-disabled [data-abnormal-sku] { cursor:default!important; }
      #kzqc-panel { position:fixed; right:18px; bottom:18px; z-index:2147483000; width:390px; max-height:82vh; background:#fff; border:1px solid #dbe3ef; border-radius:16px; box-shadow:0 18px 55px rgba(15,23,42,.25); overflow:hidden; font-family:Arial,sans-serif; color:#172033; }
      #kzqc-panel.minimized { width:270px; }
      .kzqc-header { background:linear-gradient(135deg,#111827,#24314a); color:#fff; padding:13px 14px; display:flex; align-items:center; justify-content:space-between; cursor:move; }
      .kzqc-title { font-size:14px; font-weight:800; }
      .kzqc-version { font-size:10px; color:#9fb0c9; margin-top:2px; }
      .kzqc-header button { border:0; background:rgba(255,255,255,.12); color:#fff; border-radius:8px; width:31px; height:31px; cursor:pointer; font-size:16px; }
      .kzqc-body { padding:13px; overflow:auto; max-height:calc(82vh - 58px); }
      .kzqc-status-row { display:flex; gap:8px; margin-bottom:10px; }
      .kzqc-badge { flex:1; padding:8px 10px; border-radius:10px; background:#f4f7fb; font-size:11px; font-weight:700; }
      .kzqc-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; background:#dc2626; }
      .kzqc-dot.online { background:#16a34a; }
      .kzqc-select, #kzqc-scanner { width:100%; border:1px solid #ccd6e5; border-radius:10px; background:#fff; padding:10px 11px; font-size:13px; outline:none; }
      #kzqc-scanner { font-size:16px; font-weight:800; letter-spacing:.4px; border:2px solid #2563eb; margin-top:9px; }
      .kzqc-label { display:block; font-size:11px; color:#60708a; font-weight:700; margin:9px 0 5px; }
      .kzqc-message { margin-top:10px; padding:9px 10px; border-radius:9px; font-size:11px; line-height:1.4; background:#eff6ff; color:#1d4ed8; }
      .kzqc-message.success { background:#ecfdf5; color:#047857; }
      .kzqc-message.error { background:#fef2f2; color:#b91c1c; }
      .kzqc-message.warn { background:#fffbeb; color:#a16207; }
      .kzqc-counters { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin:10px 0; }
      .kzqc-tabs { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0; }
      .kzqc-filter-title { font-size:10px; font-weight:800; color:#64748b; margin:9px 0 5px; text-transform:uppercase; }
      .kzqc-channel-filters { display:flex; flex-wrap:wrap; gap:5px; }
      .kzqc-filter-btn { border:1px solid #dbe3ef; background:#fff; color:#475569; border-radius:999px; padding:6px 9px; font-size:10px; font-weight:800; cursor:pointer; }
      .kzqc-filter-btn.active { background:#0f766e; border-color:#0f766e; color:#fff; }
      .kzqc-fast-filters { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:7px; }
      .kzqc-fast-filters button { border:1px solid #dbe3ef; border-radius:8px; padding:7px; font-size:10px; font-weight:800; background:#f8fafc; color:#475569; cursor:pointer; }
      .kzqc-fast-filters button.active { background:#f59e0b; color:#fff; border-color:#f59e0b; }
      .kzqc-deadline { display:inline-block; margin-top:4px; border-radius:999px; padding:3px 6px; font-size:9px; font-weight:800; background:#eef2ff; color:#4338ca; }
      .kzqc-deadline.today { background:#fee2e2; color:#b91c1c; }
      .kzqc-tab { border:1px solid #dbe3ef; background:#f7f9fc; color:#475569; border-radius:9px; padding:8px 5px; font-size:10px; font-weight:800; cursor:pointer; line-height:1.25; }
      .kzqc-tab.active { background:#2563eb; color:#fff; border-color:#2563eb; }
      .kzqc-tab b { display:block; font-size:15px; margin-bottom:2px; }
      .kzqc-session { border:2px solid #2563eb; border-radius:12px; overflow:hidden; margin-top:10px; }
      .kzqc-session-head { background:#eff6ff; padding:10px; display:flex; justify-content:space-between; gap:8px; align-items:center; }
      .kzqc-session-order { font-size:13px; font-weight:900; }
      .kzqc-session-progress { font-size:12px; font-weight:900; color:#1d4ed8; }
      .kzqc-session-item { display:grid; grid-template-columns:36px 1fr auto; gap:8px; align-items:center; padding:8px 9px; border-top:1px solid #e5eaf2; }
      .kzqc-session-item img { width:36px; height:36px; object-fit:contain; border-radius:6px; background:#f8fafc; }
      .kzqc-session-qty { font-size:14px; font-weight:900; color:#0f172a; }
      .kzqc-session-item.partial { background:#fffbeb; }
      .kzqc-session-item.done { background:#ecfdf5; }
      .kzqc-session-actions { padding:8px; border-top:1px solid #e5eaf2; }
      .kzqc-session-actions button { width:100%; border:0; border-radius:8px; padding:8px; background:#fee2e2; color:#991b1b; font-weight:800; cursor:pointer; }
      .kzqc-session-actions button.primary { background:#dbeafe; color:#1d4ed8; }
      .kzqc-multi-summary { font-size:10px; color:#64748b; margin-top:3px; white-space:normal; line-height:1.35; }
      .kzqc-row-count.wide { min-width:72px; padding:0 7px; font-size:11px; }
      .kzqc-counter { background:#f7f9fc; border:1px solid #e8edf5; border-radius:10px; padding:8px; text-align:center; }
      .kzqc-counter strong { display:block; font-size:17px; }
      .kzqc-counter span { font-size:9px; color:#64748b; text-transform:uppercase; }
      .kzqc-list { border:1px solid #e5eaf2; border-radius:11px; overflow:hidden; max-height:270px; overflow-y:auto; }
      .kzqc-row { display:flex; align-items:center; gap:9px; padding:8px 9px; border-bottom:1px solid #edf1f6; cursor:pointer; background:#fff; }
      .kzqc-row:last-child { border-bottom:0; }
      .kzqc-row:hover { background:#f3f7ff; }
      .kzqc-row img { width:38px; height:38px; object-fit:contain; border-radius:7px; background:#f4f4f4; }
      .kzqc-row-info { min-width:0; flex:1; }
      .kzqc-row-sku { font-size:12px; font-weight:900; }
      .kzqc-row-name { font-size:10px; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
      .kzqc-row-count { min-width:39px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:9px; background:#2563eb; color:#fff; font-size:14px; font-weight:900; }
      .kzqc-actions { display:flex; gap:7px; margin-top:10px; }
      .kzqc-actions button { flex:1; border:0; border-radius:9px; padding:9px; cursor:pointer; font-size:11px; font-weight:800; }
      .kzqc-actions button:disabled { opacity:.6; cursor:not-allowed; }
      .kzqc-actions .primary { background:#2563eb; color:#fff; }
      .kzqc-actions .secondary { background:#e9eef6; color:#334155; }
      .kzqc-pending { margin-top:10px; padding:10px; border-radius:10px; background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; font-size:11px; }
      .kzqc-pending button { margin-top:7px; width:100%; padding:8px; border:0; border-radius:8px; background:#ea580c; color:#fff; font-weight:800; cursor:pointer; }
      .kzqc-overdue-alert { margin-bottom:12px; padding:12px 14px; border-radius:10px; background:#fff1f0; border:2px solid #ff4d4f; color:#a8071a; font-size:12px; }
      .kzqc-overdue-alert > b { display:block; font-size:13px; margin-bottom:8px; }
      .kzqc-overdue-list { display:flex; flex-direction:column; gap:6px; max-height:180px; overflow-y:auto; }
      .kzqc-overdue-row { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding:8px 10px; border:1px solid #ffa39e; border-radius:8px; background:#fff; color:#a8071a; font-weight:700; font-size:12px; cursor:pointer; text-align:left; }
      .kzqc-overdue-row:hover { background:#fff1f0; border-color:#ff4d4f; }
      .kzqc-overdue-row small { color:#cf1322; font-weight:500; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .kzqc-pc-list { display:flex; flex-direction:column; gap:10px; max-height:min(56vh,460px); overflow-y:auto; margin:14px 0; }
      .kzqc-pc-row { display:grid; grid-template-columns:1fr auto 1fr; gap:10px; align-items:start; padding:10px; border:1px solid #eee; border-radius:8px; background:#fafafa; }
      .kzqc-pc-current, .kzqc-pc-selected { display:flex; align-items:center; gap:8px; }
      .kzqc-pc-chosen { display:flex; flex-direction:column; gap:6px; margin-bottom:6px; }
      .kzqc-pc-chosen:empty { display:none; }
      .kzqc-pc-selected { padding:6px; border:1px solid #d6e4ff; border-radius:6px; background:#f0f7ff; }
      .kzqc-pc-current img, .kzqc-pc-selected img, .kzqc-pc-result img { width:40px; height:40px; object-fit:contain; border:1px solid #eee; border-radius:6px; background:#fff; flex:0 0 auto; }
      .kzqc-pc-noimg { width:40px; height:40px; border:1px solid #eee; border-radius:6px; background:#fff; flex:0 0 auto; display:inline-block; }
      .kzqc-pc-current b, .kzqc-pc-selected b { display:block; font-size:12px; }
      .kzqc-pc-current small, .kzqc-pc-selected small { display:block; color:#8c8c8c; font-size:10px; }
      .kzqc-pc-selected em { display:block; color:#1677ff; font-size:10px; font-style:normal; font-weight:700; }
      .kzqc-pc-kit-current { display:flex; flex-direction:column; gap:6px; width:100%; }
      .kzqc-pc-kit-current > b { display:block; font-size:12px; }
      .kzqc-pc-kit-comp { display:flex; align-items:center; gap:6px; }
      .kzqc-pc-kit-comp img, .kzqc-pc-kit-comp .kzqc-pc-noimg { width:28px; height:28px; object-fit:contain; border:1px solid #eee; border-radius:6px; background:#fff; flex:0 0 auto; }
      .kzqc-pc-kit-comp span { font-size:11px; }
      .kzqc-pc-kit-comp small { display:block; color:#8c8c8c; font-size:10px; }
      .kzqc-pc-hint { font-size:11px; color:#d46b08; background:#fff7e6; border:1px solid #ffe7ba; border-radius:6px; padding:6px 8px; margin-bottom:6px; }
      .kzqc-pc-arrow { font-size:16px; color:#8c8c8c; align-self:center; }
      .kzqc-pc-target { min-width:0; }
      .kzqc-pc-target > em { font-style:normal; color:#8c8c8c; font-size:11px; }
      .kzqc-pc-search { width:100%; height:34px; border:1px solid #d9d9d9; border-radius:6px; padding:0 10px; font:inherit; box-sizing:border-box; }
      .kzqc-pc-results { display:flex; flex-direction:column; gap:4px; margin-top:6px; max-height:200px; overflow-y:auto; }
      .kzqc-pc-result { display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; border:1px solid #eee; border-radius:6px; background:#fff; cursor:pointer; text-align:left; }
      .kzqc-pc-result:hover { border-color:#1677ff; background:#f0f7ff; }
      .kzqc-pc-result span { flex:1; min-width:0; }
      .kzqc-pc-result b { display:block; font-size:12px; }
      .kzqc-pc-result small { display:block; color:#8c8c8c; font-size:10px; }
      .kzqc-pc-result em { font-style:normal; color:#1677ff; font-size:10px; font-weight:700; white-space:nowrap; }
      .kzqc-pc-loading { padding:8px; color:#8c8c8c; font-size:11px; }
      .kzqc-pc-qty { display:flex; align-items:center; gap:4px; font-size:10px; color:#595959; }
      .kzqc-pc-qty input { width:44px; height:26px; border:1px solid #d9d9d9; border-radius:4px; text-align:center; }
      .kzqc-pc-clear { border:0; background:#fff1f0; color:#cf1322; width:22px; height:22px; border-radius:50%; cursor:pointer; font-size:13px; line-height:1; }
      .kzqc-last { position:sticky; top:0; z-index:4; margin:0 0 10px; border:1px solid #bbf7d0; background:#f0fdf4; border-radius:11px; padding:9px; }
      .kzqc-last-title { font-size:10px; font-weight:900; color:#15803d; text-transform:uppercase; margin-bottom:6px; }
      .kzqc-last-body { display:grid; grid-template-columns:42px 1fr auto; gap:8px; align-items:center; }
      .kzqc-last-body img { width:42px; height:42px; object-fit:contain; border-radius:7px; background:#fff; }
      .kzqc-last-qty { font-size:18px; font-weight:900; color:#166534; }
      #kzqc-history-modal { position:fixed; inset:0; z-index:2147483646; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; font-family:Arial,sans-serif; }
      .kzqc-history-card { width:min(780px,calc(100% - 28px)); max-height:82vh; background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 24px 80px rgba(0,0,0,.28); }
      .kzqc-history-head { padding:14px 16px; background:#14213d; color:#fff; display:flex; justify-content:space-between; align-items:center; }
      .kzqc-history-head div div { font-size:11px; opacity:.75; margin-top:2px; }
      .kzqc-history-head button { border:0; background:rgba(255,255,255,.12); color:#fff; width:30px; height:30px; border-radius:7px; font-size:20px; cursor:pointer; }
      .kzqc-history-list { padding:10px; overflow:auto; max-height:calc(82vh - 64px); }
      .kzqc-history-row { display:grid; grid-template-columns:48px 1fr auto; gap:10px; align-items:center; padding:10px; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:8px; }
      .kzqc-history-row img,.kzqc-history-placeholder { width:48px; height:48px; object-fit:contain; border-radius:7px; background:#f8fafc; }
      .kzqc-history-info { min-width:0; font-size:11px; color:#64748b; line-height:1.45; }
      .kzqc-history-sku { font-size:13px; font-weight:900; color:#111827; }
      .kzqc-history-reprint { border:0; border-radius:8px; background:#2563eb; color:#fff; padding:9px 11px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap; }
      .kzqc-reprint-count { color:#ea580c; font-weight:700; }
      .kzqc-history-button { width:100%; border:1px solid #cbd5e1; background:#fff; color:#1e293b; border-radius:8px; padding:8px; font-size:11px; font-weight:800; cursor:pointer; margin:0 0 8px; }

      .kzqc-order-card { width:560px; }
      #kzqc-order-text { width:100%; height:320px; margin-top:12px; border:1px solid #cbd5e1; border-radius:10px; padding:10px; resize:vertical; font:12px/1.5 Consolas,monospace; }
      .kzqc-empty { padding:20px; text-align:center; color:#718096; font-size:11px; }
      #kzqc-modal { position:fixed; inset:0; z-index:2147483646; background:rgba(15,23,42,.58); display:flex; align-items:center; justify-content:center; font-family:Arial,sans-serif; }
      .kzqc-modal-card { width:500px; max-width:calc(100% - 30px); background:#fff; border-radius:16px; padding:22px; box-shadow:0 20px 70px rgba(0,0,0,.3); }
      .kzqc-modal-title { font-size:20px; font-weight:900; color:#172033; }
      .kzqc-modal-subtitle { margin-top:6px; font-size:12px; color:#64748b; line-height:1.5; }
      .kzqc-qty-row { display:grid; grid-template-columns:44px 1fr 44px; gap:8px; align-items:center; }
      .kzqc-qty-row button { height:44px; border:0; border-radius:10px; background:#e8eef7; font-size:20px; cursor:pointer; }
      .kzqc-qty-row input { height:44px; border:2px solid #2563eb; border-radius:10px; text-align:center; font-size:20px; font-weight:900; }
      .kzqc-modal-actions { display:flex; gap:8px; margin-top:18px; }
      .kzqc-modal-actions button { flex:1; border:0; border-radius:10px; padding:11px; font-weight:800; cursor:pointer; }
      .kzqc-modal-actions .primary { background:#2563eb; color:#fff; }
      .kzqc-modal-actions .secondary { background:#edf1f6; color:#334155; }
      #kzqc-open-fullscreen { width:100%; border:0; border-radius:9px; padding:10px; margin-top:8px; background:#0f172a; color:#fff; font-weight:900; cursor:pointer; }
      body.kzqc-fullscreen-body { margin:0 !important; background:#f5f7fa !important; overflow:hidden !important; }
      body.kzqc-fullscreen-body > *:not(#kzqc-panel):not(#kzqc-history-modal):not(#kzqc-order-modal):not(#kzqc-modal):not(#kzqc-image-preview) { display:none !important; }
      #kzqc-panel.kzqc-fullscreen { position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; max-height:none !important; border-radius:0 !important; box-shadow:none !important; z-index:2147483600 !important; background:#f5f7fa !important; }
      #kzqc-panel.kzqc-fullscreen .kzqc-header { height:64px; padding:0 32px; border-radius:0; }
      #kzqc-panel.kzqc-fullscreen .kzqc-body { width:min(1180px,calc(100vw - 48px)); height:calc(100vh - 64px); margin:0 auto; padding:24px; overflow:auto; background:#fff; box-sizing:border-box; }
      #kzqc-panel.kzqc-fullscreen #kzqc-scanner { height:52px; font-size:19px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-list { max-height:430px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row { padding:11px 13px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row img { width:52px; height:52px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session { max-width:900px; margin:14px auto 0; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session-item { grid-template-columns:58px 1fr auto; padding:13px 16px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session-item img { width:58px; height:58px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-last { position:relative; }
      #kzqc-panel.kzqc-fullscreen .kzqc-title { font-size:18px; }
      .kzqc-header-actions { display:flex; align-items:center; gap:8px; }
      .kzqc-back-btn { border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.12); color:#fff; border-radius:7px; padding:8px 12px; cursor:pointer; font-weight:800; }
      /* v0.2.1 — layout profissional inspirado no checkout do UpSeller */
      #kzqc-panel.kzqc-fullscreen { font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif !important; color:#262626; }
      #kzqc-panel.kzqc-fullscreen .kzqc-header { height:68px; padding:0 28px; background:#fff; color:#262626; border-bottom:1px solid #e8e8e8; box-shadow:0 1px 4px rgba(0,0,0,.04); }
      .kzqc-brand-wrap { display:flex; align-items:center; gap:12px; }
      .kzqc-logo-mark { width:36px; height:36px; border-radius:9px; display:grid; place-items:center; background:#000; color:#fff; font-size:18px; font-weight:800; box-shadow:0 6px 14px rgba(0,0,0,.25); overflow:hidden; }
      .kzqc-logo-mark img { width:100%; height:100%; object-fit:contain; }
      #kzqc-panel.kzqc-fullscreen .kzqc-title { font-size:17px; line-height:1.2; color:#262626; font-weight:600; }
      #kzqc-panel.kzqc-fullscreen .kzqc-version { color:#8c8c8c; font-size:11px; margin-top:3px; }
      .kzqc-plugin-pill { display:flex; align-items:center; gap:7px; border:1px solid #ffccc7; background:#fff2f0; color:#cf1322; border-radius:999px; padding:7px 11px; font-size:12px; font-weight:500; }
      .kzqc-plugin-pill span { width:7px; height:7px; border-radius:50%; background:#ff4d4f; }
      .kzqc-plugin-pill.online { border-color:#b7eb8f; background:#f6ffed; color:#389e0d; }
      .kzqc-plugin-pill.online span { background:#52c41a; }
      #kzqc-panel.kzqc-fullscreen .kzqc-back-btn { border:1px solid #d9d9d9; background:#fff; color:#595959; border-radius:4px; padding:8px 14px; font-weight:500; }
      body.kzqc-fullscreen-body { background:#f5f5f5 !important; }
      #kzqc-panel.kzqc-fullscreen .kzqc-body { width:100%; height:calc(100vh - 68px); margin:0; padding:22px 28px; overflow:hidden; background:#f5f5f5; display:grid; grid-template-columns:252px minmax(0,1fr); gap:20px; }
      .kzqc-sidebar { min-width:0; overflow:auto; padding-right:2px; }
      .kzqc-sidebar-section, .kzqc-last { background:#fff; border:1px solid #e8e8e8; border-radius:8px; padding:16px; margin-bottom:14px; box-shadow:0 1px 2px rgba(0,0,0,.02); }
      .kzqc-section-title { font-size:13px; font-weight:600; color:#262626; margin-bottom:12px; }
      .kzqc-label { font-size:12px; color:#595959; margin:0 0 6px; font-weight:400; }
      .kzqc-select { height:38px; border:1px solid #d9d9d9; border-radius:4px; padding:0 10px; font-size:13px; }
      .kzqc-select:focus { border-color:#40a9ff; box-shadow:0 0 0 2px rgba(24,144,255,.15); }
      .kzqc-side-action { width:100%; margin-top:8px; height:36px; border:1px solid #d9d9d9; background:#fff; color:#595959; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500; text-align:left; padding:0 11px; display:flex; align-items:center; justify-content:space-between; }
      .kzqc-side-action:hover { color:#0049e5; border-color:#0049e5; }
      .kzqc-side-action.primary { background:#0049e5; color:#fff; border-color:#0049e5; justify-content:center; }
      .kzqc-side-action.active { background:#e6f2ff; border-color:#0049e5; color:#0049e5; font-weight:600; }
      .kzqc-switch-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 2px; }
      .kzqc-switch-row span { font-size:12px; font-weight:500; color:#595959; }
      .kzqc-switch { font-size:16px; position:relative; display:inline-flex; align-items:center; width:2.6em; height:1.5em; flex:0 0 auto; }
      .kzqc-switch input { opacity:0; width:0; height:0; }
      .kzqc-slider { position:absolute; cursor:pointer; top:0; right:0; bottom:0; left:0; background:#e2e2e2; border-radius:50px; overflow:hidden; transition:all .3s cubic-bezier(.215,.61,.355,1); }
      .kzqc-slider:before { position:absolute; content:""; height:1.1em; width:1.1em; right:.2em; top:50%; margin-top:-.55em; transform:translateX(150%); background-color:#59d102; border-radius:50%; transition:all .3s cubic-bezier(.215,.61,.355,1); }
      .kzqc-slider:after { position:absolute; content:""; height:1.1em; width:1.1em; left:.2em; top:50%; margin-top:-.55em; background-color:#cccccc; border-radius:50%; transition:all .3s cubic-bezier(.215,.61,.355,1); }
      .kzqc-switch input:focus + .kzqc-slider { box-shadow:0 0 1px #59d102; }
      .kzqc-switch input:checked + .kzqc-slider:before { transform:translateY(0); }
      .kzqc-switch input:checked + .kzqc-slider:after { transform:translateX(-150%); }
      .kzqc-channel-filters { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
      .kzqc-filter-btn { border-radius:4px; padding:8px 6px; font-size:11px; font-weight:500; }
      .kzqc-filter-btn.active { background:#e6f2ff; border-color:#0049e5; color:#0049e5; }
      .kzqc-fast-filters { gap:7px; }
      .kzqc-fast-filters button { border-radius:4px; background:#fff; padding:8px 5px; font-weight:500; }
      .kzqc-fast-filters button.active { background:#fff7e6; color:#d46b08; border-color:#ffa940; }
      .kzqc-last { position:relative; top:auto; }
      .kzqc-last-title { color:#595959; text-transform:none; font-size:12px; font-weight:600; }
      .kzqc-last-body { grid-template-columns:46px 1fr auto; }
      .kzqc-last-body img,.kzqc-last-placeholder { width:46px; height:46px; border:1px solid #f0f0f0; border-radius:6px; background:#fafafa; }
      .kzqc-last-orders { font-size:10px; color:#8c8c8c; margin-top:3px; }
      .kzqc-last-qty { color:#0049e5; font-size:20px; }
      .kzqc-last-copy { min-width:0; overflow:hidden; }
      .kzqc-last .kzqc-row-name { display:block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:help; }
      .kzqc-modal-product { display:grid; grid-template-columns:72px minmax(0,1fr); gap:12px; align-items:center; margin:14px 0 18px; padding:12px; border:1px solid #e8e8e8; border-radius:10px; background:#fafafa; }
      .kzqc-modal-product img,.kzqc-modal-product-placeholder { width:72px; height:72px; object-fit:contain; border-radius:8px; background:#fff; border:1px solid #f0f0f0; }
      .kzqc-modal-product b { display:block; font-size:14px; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .kzqc-modal-product small { display:block; color:#8c8c8c; margin-top:5px; }
      .kzqc-log-modal textarea { width:100%; min-height:330px; resize:vertical; margin-top:12px; padding:12px; border:1px solid #d9d9d9; border-radius:8px; background:#111827; color:#e5e7eb; font:11px/1.45 Consolas,monospace; }

      #kzqc-open-fullscreen { border-radius:4px; background:#262626; font-weight:500; }
      .kzqc-main { min-width:0; overflow:auto; padding-right:2px; }
      .kzqc-top-card,.kzqc-work-card { background:#fff; border:1px solid #e8e8e8; border-radius:8px; box-shadow:0 1px 2px rgba(0,0,0,.02); }
      .kzqc-top-card { padding:22px 24px; position:relative; }
      .kzqc-marketplace-bar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:12px; padding:11px 14px; background:#fff; border:1px solid #e8e8e8; border-radius:8px; }
      .kzqc-marketplace-item { position:relative; flex:0 0 auto; }
      .kzqc-store-dropdown { position:absolute; top:100%; left:0; display:none; flex-direction:column; gap:2px; background:#fff; border:1px solid #d9d9d9; border-radius:8px; box-shadow:0 8px 20px rgba(0,0,0,.14); min-width:190px; max-height:280px; overflow-y:auto; z-index:30; padding:8px; }
      .kzqc-marketplace-item:hover .kzqc-store-dropdown, .kzqc-store-dropdown:hover { display:flex; }
      .kzqc-store-dropdown-title { font-size:10px; font-weight:700; color:#8c8c8c; text-transform:uppercase; padding:2px 8px 6px; }
      .kzqc-store-dropdown-item { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding:7px 8px; border:0; border-radius:6px; background:transparent; color:#595959; font-size:12px; font-weight:500; text-align:left; cursor:pointer; white-space:nowrap; }
      .kzqc-store-dropdown-item:hover { background:#f5f7fa; }
      .kzqc-store-dropdown-item.active { background:#e6f2ff; color:#0049e5; font-weight:700; }
      .kzqc-store-dropdown-item span { color:#8c8c8c; font-size:10px; font-weight:600; }
      .kzqc-store-dropdown-item.active span { color:#0049e5; }
      .kzqc-marketplace-label { flex:0 0 auto; color:#8c8c8c; font-size:11px; font-weight:500; margin-right:2px; }
      .kzqc-marketplace-bar .kzqc-filter-btn { position:relative; flex:0 0 auto; display:flex; align-items:center; justify-content:center; gap:6px; min-width:86px; height:40px; padding:6px 14px; border:1px solid #d9d9d9; border-radius:4px; background:#fff; color:#595959; font-size:11px; font-weight:500; white-space:nowrap; cursor:pointer; overflow:visible; }
      .kzqc-marketplace-bar .kzqc-filter-btn:hover { color:#0049e5; border-color:#0049e5; }
      .kzqc-marketplace-bar .kzqc-filter-btn.active { background:#e6f2ff!important; border-color:#0049e5!important; color:#0049e5!important; }
      .kzqc-marketplace-bar .kzqc-marketplace-count { position:absolute; top:-7px; right:-7px; display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 4px; border-radius:10px; background:#8c8c8c; color:#fff; font-size:9px; font-weight:700; border:1.5px solid #fff; box-shadow:0 1px 2px rgba(0,0,0,.18); z-index:1; }
      .kzqc-marketplace-bar .kzqc-filter-btn[data-channel="all"] .kzqc-marketplace-count { position:static; border:0; box-shadow:none; background:#f0f0f0; color:#8c8c8c; }
      .kzqc-marketplace-bar .kzqc-filter-btn.active .kzqc-marketplace-count { background:#0049e5; color:#fff; border-color:#fff; }
      .kzqc-marketplace-bar .kzqc-filter-btn[data-channel="all"].active .kzqc-marketplace-count { background:#fff; color:#0049e5; }
      #kzqc-image-preview { position:fixed;z-index:2147483647;width:220px;height:220px;padding:8px;background:#fff;border:1px solid #d9d9d9;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none;display:none; }
      #kzqc-image-preview img { width:100%;height:100%;object-fit:contain; }
      .kzqc-eyebrow { color:#0049e5; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; }
      .kzqc-top-copy h1 { margin:4px 0 5px; font-size:22px; line-height:1.3; color:#262626; font-weight:600; }
      .kzqc-top-copy p { margin:0; color:#8c8c8c; font-size:13px; }
      .kzqc-queue-chip { position:absolute; right:24px; top:24px; border-radius:999px; background:#f0f5ff; color:#2f54eb; padding:7px 12px; font-size:11px; font-weight:500; }
      .kzqc-scan-wrap { margin-top:20px; height:54px; display:grid; grid-template-columns:52px 1fr 68px; align-items:center; border:2px solid #0049e5; border-radius:6px; background:#fff; box-shadow:0 0 0 3px rgba(0,73,229,.08); overflow:hidden; }
      .kzqc-scan-icon { height:100%; display:grid; place-items:center; color:#0049e5; background:#f0f5ff; font-size:25px; border-right:1px solid #adc6ff; }
      #kzqc-panel.kzqc-fullscreen #kzqc-scanner { margin:0; height:50px; border:0; border-radius:0; padding:0 16px; font-size:18px; font-weight:500; letter-spacing:0; box-shadow:none; }
      #kzqc-panel.kzqc-fullscreen #kzqc-scanner:focus { outline:none; }
      .kzqc-enter-key { color:#8c8c8c; font-size:10px; text-align:center; border-left:1px solid #f0f0f0; letter-spacing:.8px; }
      .kzqc-message { margin-top:12px; border-radius:4px; padding:9px 12px; font-size:12px; }
      .kzqc-work-card { margin-top:18px; padding:0 22px 22px; }
      .kzqc-tabs { display:flex; gap:0; margin:0 -22px 18px; padding:0 22px; border-bottom:1px solid #f0f0f0; }
      .kzqc-tab { position:relative; min-width:190px; border:0; background:transparent; color:#595959; border-radius:0; padding:17px 44px 14px 0; text-align:left; font-size:13px; font-weight:500; line-height:1.25; }
      .kzqc-tab + .kzqc-tab { margin-left:30px; }
      .kzqc-tab span { display:block; color:inherit; }
      .kzqc-tab small { display:block; margin-top:3px; color:#8c8c8c; font-size:11px; font-weight:400; }
      .kzqc-tab b { position:absolute; right:4px; top:19px; display:grid; place-items:center; min-width:28px; height:24px; padding:0 7px; border-radius:12px; background:#f5f5f5; color:#595959; font-size:12px; margin:0; }
      .kzqc-tab.active { background:transparent; color:#0049e5; }
      .kzqc-tab.active:after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:#0049e5; }
      .kzqc-tab.active b { background:#e6f2ff; color:#0049e5; }
      .kzqc-content-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .kzqc-content-title { font-size:15px; font-weight:600; color:#262626; }
      .kzqc-content-subtitle { font-size:11px; color:#8c8c8c; margin-top:3px; }
      .kzqc-total-pill { border:1px solid #d9d9d9; border-radius:999px; padding:5px 10px; color:#595959; font-size:11px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-list { max-height:calc(100vh - 408px); border:1px solid #f0f0f0; border-radius:6px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row { min-height:68px; padding:9px 14px; gap:12px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row:hover { background:#f5f9ff; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row img { width:48px; height:48px; border:1px solid #f0f0f0; border-radius:6px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row-sku { font-size:13px; font-weight:600; color:#262626; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row-name { font-size:11px; color:#8c8c8c; margin-top:4px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row-count { background:#f0f5ff; color:#2f54eb; border-radius:4px; min-width:48px; height:34px; font-size:13px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-row-count.wide { min-width:78px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session { max-width:none; border:1px solid #adc6ff; border-radius:6px; margin:0; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session-head { background:#f0f5ff; padding:14px 16px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session-item { grid-template-columns:52px 1fr auto; padding:12px 16px; }
      #kzqc-panel.kzqc-fullscreen .kzqc-session-item img { width:48px; height:48px; border:1px solid #f0f0f0; border-radius:6px; }
      @media (max-width:980px) {
        #kzqc-panel.kzqc-fullscreen .kzqc-body { grid-template-columns:1fr; overflow:auto; }
        .kzqc-sidebar { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; overflow:visible; }
        .kzqc-sidebar-section,.kzqc-last { margin:0; }
        .kzqc-main { overflow:visible; }
        #kzqc-panel.kzqc-fullscreen .kzqc-list { max-height:480px; }
      }

      /* v0.2.2 refinamentos */
      #kzqc-panel.kzqc-fullscreen .kzqc-header-actions .kzqc-close-btn{width:36px;height:36px;border:0;background:#f5f5f5;color:#595959;border-radius:50%;font-size:22px;line-height:34px;cursor:pointer}
      #kzqc-panel.kzqc-fullscreen .kzqc-body{grid-template-columns:280px minmax(520px,1fr) 260px;gap:16px;max-width:1680px}
      .kzqc-sidebar{overflow:visible!important;scrollbar-width:none}.kzqc-sidebar::-webkit-scrollbar{display:none}
      .kzqc-priority-card .kzqc-fast-filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:0}
      .kzqc-tabs{gap:10px;border-bottom:0!important}.kzqc-tab{border:1px solid #e8e8e8!important;border-radius:8px!important;background:#fff!important;padding:12px 14px!important}.kzqc-tab:after{display:none!important}.kzqc-tab.active{background:#1677ff!important;border-color:#1677ff!important;color:#fff!important;box-shadow:0 4px 12px rgba(22,119,255,.18)}.kzqc-tab.active small,.kzqc-tab.active b{color:#fff!important}
      .kzqc-deadline{font-weight:400!important;font-size:11px!important;background:transparent!important;color:#8c8c8c!important;padding:0!important;margin-top:5px!important}.kzqc-deadline.today{color:#d4380d!important}
      .kzqc-right-queue{min-width:0;background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;height:calc(100vh - 100px);overflow:hidden;display:flex;flex-direction:column}.kzqc-right-title{font-size:14px;font-weight:600;color:#262626;margin-bottom:10px}.kzqc-scope-toggle{border:1px solid #d9d9d9;background:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:700;color:#64748b;cursor:pointer}.kzqc-scope-toggle.active{background:#e6f4ff;border-color:#1677ff;color:#1677ff}.kzqc-sku-search{width:100%;height:34px;border:1px solid #d9d9d9;border-radius:4px;padding:0 10px;font:inherit;box-sizing:border-box}.kzqc-size-filters{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin:8px 0}.kzqc-size-btn{height:30px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;font-size:11px;cursor:pointer}.kzqc-size-btn.active{background:#1677ff;color:#fff;border-color:#1677ff}.kzqc-sku-queue-list{overflow:auto;flex:1}.kzqc-sku-queue-row{display:grid;grid-template-columns:38px 1fr auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0}.kzqc-sku-queue-row img{width:38px;height:38px;object-fit:contain;border:1px solid #f0f0f0;border-radius:4px}.kzqc-sku-queue-row b{display:block;font-size:12px}.kzqc-sku-queue-row small{display:block;color:#8c8c8c;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kzqc-sku-queue-qty{font-size:15px;font-weight:600;color:#1677ff}.kzqc-abnormal-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px;border-bottom:1px solid #eee}.kzqc-abnormal-row small{display:block;color:#8c8c8c;margin-top:3px}.kzqc-abnormal-row button,.danger{border:1px solid #ff4d4f!important;background:#fff1f0!important;color:#cf1322!important;border-radius:4px;padding:8px 10px;cursor:pointer}.kzqc-modal-wide{width:min(760px,92vw)!important}.kzqc-abnormal-list{max-height:430px;overflow:auto;margin:12px 0}.kzqc-bulk-components{background:#fafafa;border:1px solid #eee;border-radius:8px;padding:6px 10px;margin:14px 0;max-height:340px;overflow:auto}.kzqc-bulk-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #eee}.kzqc-bulk-row:last-child{border-bottom:0}.kzqc-bulk-row img,.kzqc-bulk-row-noimg{width:40px;height:40px;object-fit:contain;border:1px solid #eee;border-radius:6px;background:#fff;flex:0 0 auto}.kzqc-bulk-row-copy{flex:1;min-width:0}.kzqc-bulk-row-copy b{display:block;font-size:12px;line-height:1.3}.kzqc-bulk-row-copy small{display:block;color:#8c8c8c;font-size:10px;margin-top:2px}.kzqc-bulk-row em{font-style:normal;font-weight:800;font-size:14px;color:#1677ff;flex:0 0 auto}.kzqc-session-actions{display:flex;gap:8px;justify-content:flex-end}.kzqc-session-actions .danger{margin-right:auto}
      @media(max-width:1200px){#kzqc-panel.kzqc-fullscreen .kzqc-body{grid-template-columns:240px 1fr}.kzqc-right-queue{grid-column:1/-1;height:320px}.kzqc-sku-queue-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}}

      /* v0.2.3 — tela cheia responsiva e launcher único */
      #kzqc-panel.kzqc-launcher-only{position:fixed;right:22px;bottom:22px;z-index:2147483500;width:auto;height:auto;background:transparent;box-shadow:none;border:0}
      .kzqc-launcher-btn{display:flex;align-items:center;gap:10px;border:0;border-radius:12px;background:#1677ff;color:#fff;padding:10px 16px;box-shadow:0 8px 24px rgba(22,119,255,.28);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}
      .kzqc-launcher-btn:hover{background:#0958d9;transform:translateY(-1px)}.kzqc-launcher-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;color:#1677ff;font-weight:800}.kzqc-launcher-btn b,.kzqc-launcher-btn small{display:block;text-align:left}.kzqc-launcher-btn small{opacity:.78;font-size:10px;margin-top:1px}
      #kzqc-panel.kzqc-fullscreen .kzqc-body{width:100vw!important;max-width:none!important;grid-template-columns:minmax(220px,260px) minmax(0,1fr) minmax(270px,320px)!important;gap:16px!important;padding:18px 20px!important;box-sizing:border-box!important;overflow:hidden!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-sidebar,#kzqc-panel.kzqc-fullscreen .kzqc-main,#kzqc-panel.kzqc-fullscreen .kzqc-right-queue{min-width:0!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-main{overflow:hidden!important}.kzqc-work-card{min-width:0}.kzqc-tabs{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important}.kzqc-tab{min-width:0!important}.kzqc-tab span,.kzqc-tab small{white-space:normal!important}
      .kzqc-filter-btn.active,.kzqc-fast-filters button.active,.kzqc-size-btn.active,.kzqc-warehouse-btn.active{background:#1677ff!important;color:#fff!important;border-color:#1677ff!important;box-shadow:none!important}
      .kzqc-channel-filters button,.kzqc-fast-filters button,.kzqc-size-btn,.kzqc-warehouse-btn{transition:none!important}
      .kzqc-warehouse-filters{display:flex;gap:6px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:none}.kzqc-warehouse-filters::-webkit-scrollbar{display:none}.kzqc-warehouse-btn{flex:0 0 auto;max-width:150px;height:30px;padding:0 9px;border:1px solid #d9d9d9;background:#fff;border-radius:4px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .kzqc-queue-help{font-size:10px;color:#8c8c8c;margin:2px 0 6px}.kzqc-sku-queue-row{width:100%;border:0;border-bottom:1px solid #f0f0f0;background:#fff;text-align:left;cursor:pointer}.kzqc-sku-queue-row:hover{background:#f5f9ff}.kzqc-sku-queue-copy{min-width:0}.kzqc-sku-queue-row em{display:block;color:#bfbfbf;font-size:9px;font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.kzqc-img-placeholder{width:38px;height:38px;border:1px solid #f0f0f0;border-radius:4px}.kzqc-modal-input{width:100%;height:38px;border:1px solid #d9d9d9;border-radius:4px;padding:0 10px;box-sizing:border-box;font:inherit}.kzqc-modal-hint{font-size:11px;color:#8c8c8c;margin-top:8px}.kzqc-abnormal-row em{display:block;color:#d46b08;font-size:11px;font-style:normal;margin-top:5px}
      @media(max-width:1350px){#kzqc-panel.kzqc-fullscreen .kzqc-body{grid-template-columns:220px minmax(0,1fr) 280px!important;padding:14px!important;gap:12px!important}.kzqc-sidebar-section,.kzqc-last{padding:12px!important}.kzqc-top-card,.kzqc-work-card{padding:14px!important}}
      @media(max-width:1080px){#kzqc-panel.kzqc-fullscreen .kzqc-body{grid-template-columns:210px minmax(0,1fr)!important;overflow:auto!important}.kzqc-right-queue{grid-column:1/-1!important;height:280px!important}.kzqc-sku-queue-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0 12px!important}}
      @media(max-width:760px){#kzqc-panel.kzqc-fullscreen .kzqc-body{grid-template-columns:1fr!important}.kzqc-sidebar{display:block!important}.kzqc-right-queue{height:320px!important}.kzqc-sku-queue-list{grid-template-columns:1fr!important}.kzqc-tabs{grid-template-columns:1fr!important}}

      /* v0.2.4: visual clássico, logos e rolagem total */
      html.kzqc-fullscreen-page,body.kzqc-fullscreen-page{overflow-y:auto!important;overflow-x:hidden!important;height:auto!important;min-height:100vh!important;background:#f5f5f5!important}
      #kzqc-panel.kzqc-fullscreen{position:absolute!important;inset:0 0 auto 0!important;min-height:100vh!important;height:auto!important;overflow:visible!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-body{height:auto!important;min-height:calc(100vh - 72px)!important;overflow:visible!important;align-items:start!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-sidebar,#kzqc-panel.kzqc-fullscreen .kzqc-main{overflow:visible!important;max-height:none!important;height:auto!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-list{max-height:none!important;overflow:visible!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-right-queue{height:auto!important;max-height:none!important;overflow:visible!important;position:relative!important;top:auto!important}
      #kzqc-panel.kzqc-fullscreen .kzqc-sku-queue-list{overflow:visible!important;max-height:none!important}
      .kzqc-tabs{display:flex!important;gap:0!important;border-bottom:1px solid #f0f0f0!important;margin:0 -22px 18px!important;padding:0 22px!important}
      .kzqc-tab{position:relative!important;min-width:190px!important;border:0!important;background:transparent!important;color:#595959!important;border-radius:0!important;padding:17px 44px 14px 0!important;box-shadow:none!important}
      .kzqc-tab + .kzqc-tab{margin-left:30px!important}
      .kzqc-tab.active{background:transparent!important;color:#0049e5!important;border:0!important;box-shadow:none!important}
      .kzqc-tab.active:after{display:block!important;content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#0049e5}
      .kzqc-tab.active small{color:#8c8c8c!important}.kzqc-tab.active b{background:#e6f2ff!important;color:#0049e5!important}
      .kzqc-modal-card{width:min(500px,calc(100vw - 30px))!important;border-radius:12px!important;padding:18px!important}.kzqc-modal-card.kzqc-modal-wide{width:min(600px,92vw)!important}.kzqc-modal-title{font-size:20px!important}.kzqc-modal-actions{gap:7px!important;margin-top:14px!important}.kzqc-modal-actions button{min-height:38px!important;padding:8px 10px!important;border-radius:7px!important;font-size:13px!important;font-weight:600!important}.kzqc-compact-actions button{white-space:nowrap!important}
      .kzqc-filter-btn.kzqc-logo-filter{height:38px!important;padding:3px 8px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#fff!important;overflow:hidden!important}.kzqc-filter-btn.kzqc-logo-filter.active{background:#e6f2ff!important;border-color:#1677ff!important}.kzqc-market-logo{display:flex;width:100%;height:32px;align-items:center;justify-content:center}.kzqc-market-logo svg{display:block;max-width:84px;max-height:32px;width:auto;height:100%}.kzqc-all-channels{font-size:11px;font-weight:500;color:inherit}
      @media(max-width:1080px){#kzqc-panel.kzqc-fullscreen .kzqc-right-queue{position:relative!important;top:auto!important;height:auto!important}.kzqc-tabs{overflow-x:auto!important}.kzqc-tab{min-width:180px!important;flex:0 0 auto!important}}

      #kzqc-order-modal{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}
      .kzqc-right-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.kzqc-right-head .kzqc-right-title{margin:0}.kzqc-right-head button{border:0;background:transparent;color:#1677ff;font-size:10px;padding:3px 0;cursor:pointer;white-space:nowrap}.kzqc-right-head button:hover{text-decoration:underline}
      .kzqc-warehouse-rename-list{display:grid;gap:9px;max-height:380px;overflow:auto;margin:14px 0}.kzqc-warehouse-rename-list label{display:grid;grid-template-columns:minmax(150px,1fr) minmax(180px,1fr);gap:10px;align-items:center}.kzqc-warehouse-rename-list span{font-size:12px;color:#595959;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kzqc-warehouse-rename-list input{height:36px;border:1px solid #d9d9d9;border-radius:4px;padding:0 10px;font:inherit}
      .kzqc-market-logo img{display:block;max-width:96px;max-height:32px;width:auto;height:auto;object-fit:contain}


      /* v0.2.6 — interação por pedido, coringa e prazos */
      .kzqc-deadline.safe{color:#389e0d!important}.kzqc-deadline.warning{color:#d48806!important}.kzqc-deadline.critical{color:#cf1322!important}
      .kzqc-shortage-notice{margin-top:5px;padding:4px 7px;border-radius:6px;background:#fef2f2;color:#b91c1c;font-size:10px;font-weight:700;line-height:1.4}
      .kzqc-size-filters{display:none!important}.kzqc-sku-search::placeholder{color:#bfbfbf}.kzqc-queue-help strong{color:#595959}
      .kzqc-multiple-components { grid-column:1 / -1; width:40%; min-width:0; max-width:640px; margin:8px auto 0; }
      .kzqc-component-row{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;min-height:58px;border:0;border-bottom:1px solid #eee;background:transparent;padding:9px 12px;text-align:left;cursor:pointer}
      .kzqc-multiple-components{grid-column:1/-1;width:40%;min-width:0;max-width:640px;margin:8px auto 0;}
      .kzqc-component-row small{white-space:normal;line-height:1.35;max-width:none;}
      .kzqc-product-brand{color:#d92d20;font-weight:700}.kzqc-product-alias{color:#1677ff;font-weight:700}
      .kzqc-component-row:last-child{border-bottom:0}.kzqc-component-row:hover{background:#f0f5ff}.kzqc-component-row img{width:34px!important;height:34px!important}.kzqc-component-row b{font-size:12px}.kzqc-component-row small{display:block;color:#8c8c8c;font-size:10px}.kzqc-component-row em{font-style:normal;color:#1677ff;font-weight:600}
      .kzqc-row[data-kind="multipleOrder"]{display:grid!important;grid-template-columns:48px minmax(220px,1fr) 78px!important;align-items:center!important;width:100%!important}.kzqc-row[data-kind="multipleOrder"]>.kzqc-row-info{min-width:220px!important}.kzqc-row[data-kind="multipleOrder"]>.kzqc-row-info .kzqc-row-sku{white-space:nowrap!important;word-break:normal!important;overflow:hidden!important;text-overflow:ellipsis!important}.kzqc-row[data-kind="multipleOrder"]>.kzqc-row-count{white-space:nowrap!important}.kzqc-row[data-kind="multipleOrder"]>.kzqc-multiple-components{grid-column:1/-1!important}.kzqc-component-row{width:100%!important;min-width:0!important}.kzqc-row{cursor:pointer}.kzqc-row[data-kind="single1Order"] .kzqc-row-count{min-width:36px}.kzqc-sku-search{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}

      /* v0.2.7 — modal de armazém alinhado e identificação do pedido */
      #kzqc-order-modal .kzqc-modal-card.kzqc-modal-wide{width:min(620px,calc(100vw - 32px))!important;max-width:620px!important;box-sizing:border-box!important;padding:24px!important;overflow:visible!important}
      #kzqc-order-modal .kzqc-warehouse-rename-list{display:flex!important;flex-direction:column!important;gap:12px!important;max-height:min(52vh,420px)!important;overflow-y:auto!important;overflow-x:hidden!important;margin:18px 0!important;padding:2px 4px 2px 0!important;box-sizing:border-box!important}
      #kzqc-order-modal .kzqc-warehouse-rename-list label{display:grid!important;grid-template-columns:minmax(180px,1fr) minmax(220px,1.35fr)!important;gap:16px!important;align-items:center!important;width:100%!important;min-width:0!important;box-sizing:border-box!important}
      #kzqc-order-modal .kzqc-warehouse-rename-list span{min-width:0!important;font-size:12px!important;color:#595959!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      #kzqc-order-modal .kzqc-warehouse-rename-list input{width:100%!important;min-width:0!important;height:38px!important;box-sizing:border-box!important;border:1px solid #d9d9d9!important;border-radius:6px!important;padding:0 11px!important;background:#fff!important}
      #kzqc-order-modal .kzqc-modal-card.kzqc-modal-wide .kzqc-modal-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:10px!important}
      .kzqc-row-order{font-size:14px!important;font-weight:600!important;color:#262626!important;letter-spacing:.1px!important}
      .kzqc-row-product-sku{font-size:10px!important;color:#8c8c8c!important;margin-top:2px!important}
      @media(max-width:640px){#kzqc-order-modal .kzqc-modal-card.kzqc-modal-wide{padding:18px!important}#kzqc-order-modal .kzqc-warehouse-rename-list label{grid-template-columns:1fr!important;gap:6px!important}}
      #kzqc-error-flash{position:fixed;inset:0;z-index:2147483647;background:#ff0000;pointer-events:none;animation:kzqcErrorFlash .75s ease-in-out}
      @keyframes kzqcErrorFlash{0%{opacity:0}12%{opacity:.6}24%{opacity:0}36%{opacity:.6}48%{opacity:0}60%{opacity:.45}100%{opacity:0}}

    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Guarda qual pedido está no topo visível da lista (em vez de um pixel de scrollTop),
  // porque a lista muda de tamanho a cada atualização automática (pedidos saem/entram)
  // e um scrollTop fixo passa a apontar para outro lugar, dando a impressão de "voltar pro topo".
  function captureListAnchor(listEl) {
    if (!listEl) return null;
    const containerTop = listEl.getBoundingClientRect().top;
    const rows = listEl.querySelectorAll('.kzqc-row[data-order-id]');
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        return { orderId: row.dataset.orderId, offset: rect.top - containerTop };
      }
    }
    return null;
  }
  function restoreListAnchor(listEl, anchor) {
    if (!listEl || !anchor) return false;
    const escaped = window.CSS?.escape ? CSS.escape(anchor.orderId) : anchor.orderId;
    const row = listEl.querySelector(`.kzqc-row[data-order-id="${escaped}"]`);
    if (!row) return false;
    const containerTop = listEl.getBoundingClientRect().top;
    const currentOffset = row.getBoundingClientRect().top - containerTop;
    listEl.scrollTop += (currentOffset - anchor.offset);
    return true;
  }

  function renderPanel() {
    if (!FULLSCREEN_MODE && !isOrdersRoute()) { document.getElementById('kzqc-panel')?.remove(); return; }
    if (FULLSCREEN_MODE) { document.documentElement.classList.add('kzqc-fullscreen-page'); document.body?.classList.add('kzqc-fullscreen-page'); }
    if (!document.body) return setTimeout(renderPanel, 20);
    document.body.classList.toggle('kzqc-abnormal-disabled', !ENABLE_ABNORMAL_ORDERS);
    installStyles();
    let panel=document.getElementById('kzqc-panel');
    if(!panel){panel=document.createElement('div');panel.id='kzqc-panel';document.body.appendChild(panel)}
    if (!FULLSCREEN_MODE) {
      document.body.classList.remove('kzqc-fullscreen-body');
      panel.className='kzqc-launcher-only';
      panel.innerHTML=`<button id="kzqc-open-fullscreen" class="kzqc-launcher-btn"><span class="kzqc-launcher-icon">K</span><span><b>Abrir Checkout</b><small>Tela cheia</small></span></button>`;
      panel.querySelector('#kzqc-open-fullscreen').onclick=()=>window.open('/pt/order/in-process?kzCheckout=1','_blank');
      return;
    }
    const scannerWasFocused=document.activeElement?.id==='kzqc-scanner';
    const previousScannerValue=document.getElementById('kzqc-scanner')?.value||'';
    const previousListScroll=panel.querySelector('.kzqc-list')?.scrollTop||0;
    const previousListAnchor=captureListAnchor(panel.querySelector('.kzqc-list'));
const previousWindowScroll={x:window.scrollX,y:window.scrollY};    const previousExtraScroll={};['.kzqc-marketplace-bar','.kzqc-body','.kzqc-sidebar','.kzqc-main','.kzqc-sku-queue-list'].forEach(sel=>{const el=panel.querySelector(sel);if(el)previousExtraScroll[sel]={top:el.scrollTop,left:el.scrollLeft}});
    panel.classList.toggle('minimized',state.minimized);panel.classList.toggle('kzqc-fullscreen',FULLSCREEN_MODE);
    if(FULLSCREEN_MODE){document.body.classList.add('kzqc-fullscreen-body');state.minimized=false}
    const categoryCounts=getFilteredCategoryCounts();
    const unknownAnalysisOrders=(state.orders||[]).filter(o=>o.category==='unknown' && o.ignoredReason!=='after_sales');
    const unknownAnalysisIds=[...new Set(unknownAnalysisOrders.map(o=>norm(o.orderNo||o.raw?.orderNumber||o.raw?.orderNo||o.raw?.commonNo||o.raw?.platformOrderNo||o.idStr||o.raw?.idStr||o.raw?.id)).filter(Boolean))];
    const single1Groups=groupOrdersBySku('single1'); const singleManyGroups=groupOrdersBySku('singleMany'); const multipleGroups=groupMultipleOrders();
    const printerOptions=state.printers.map(printer=>{const name=typeof printer==='string'?printer:printer.name;return `<option value="${escapeHtml(name)}" ${name===state.printer?'selected':''}>${escapeHtml(name)}</option>`}).join('');
    let listHtml='';
    const single1Orders=getAvailableOrders('single1').filter(skuFilterMatches);
    const singleManyOrders=getAvailableOrders('singleMany').filter(skuFilterMatches);
    const multipleOrders=getAvailableOrders('multiple').filter(skuFilterMatches);
    // Independe de aba/filtro/categoria — pega direto de state.orders (tudo que veio do
    // UpSeller) para garantir que um pedido atrasado nunca fique invisível por causa de
    // filtro de marketplace/loja, do toggle "Vence hoje", ou de falha de categorização.
    const overdueOrders=(state.orders||[]).filter(o=>o.deadlineAt && new Date(o.deadlineAt).getTime()<=Date.now());
    if(state.activeTab==='single1') listHtml=single1Orders.length?single1Orders.slice(0,160).map((o,i)=>`<div class="kzqc-row" data-kind="single1Order" data-order-id="${escapeHtml(o.idStr)}" data-sku="${escapeHtml(o.sku||o.realItems?.[0]?.sku||'')}">${o.image?`<img src="${escapeHtml(o.image)}">`:'<div style="width:48px;height:48px;background:#f5f5f5"></div>'}<div class="kzqc-row-info"><div class="kzqc-row-sku kzqc-row-order">${escapeHtml(o.orderNo||o.idStr)}</div><div class="kzqc-row-name">${enrichedTitleHtml(o)}</div><div class="kzqc-multi-summary kzqc-row-product-sku">SKU ${escapeHtml(o.sku||o.realItems?.[0]?.sku||'')}</div>${deadlineBadge(o)}</div><div class="kzqc-row-count">1</div></div>`).join(''):'<div class="kzqc-empty">Nenhum pedido Item Único (=1).</div>';
    else if(state.activeTab==='singleMany') listHtml=singleManyOrders.length?singleManyOrders.slice(0,160).map((o,i)=>`<div class="kzqc-row" data-kind="singleManyOrder" data-order-id="${escapeHtml(o.idStr)}" data-sku="${escapeHtml(o.sku||o.realItems?.[0]?.sku||'')}">${o.image?`<img src="${escapeHtml(o.image)}">`:'<div style="width:48px;height:48px;background:#f5f5f5"></div>'}<div class="kzqc-row-info"><div class="kzqc-row-sku">${escapeHtml(o.sku||o.realItems?.[0]?.sku||'')}</div><div class="kzqc-row-name">${enrichedTitleHtml(o)}</div><div class="kzqc-multi-summary">${escapeHtml(o.orderNo||o.idStr)} · ${Number(o.totalQty||0)} un</div>${deadlineBadge(o)}${orderShortageNoticeHtml(o)}</div><div class="kzqc-row-count wide">1 ped<br>${Number(o.totalQty||0)} un</div></div>`).join(''):'<div class="kzqc-empty">Nenhum pedido Item Único (&gt;1).</div>';
    else listHtml=multipleOrders.length?multipleOrders.slice(0,160).map((o,i)=>{const summary=(o.realItems||[]).map(item=>`${Number(item.qty||0)}× ${item.sku}`).join(' · ');const expanded=state.expandedMultipleId===o.idStr;return `<div class="kzqc-row ${expanded?'expanded':''}" data-kind="multipleOrder" data-order-id="${escapeHtml(o.idStr)}">${o.realItems?.[0]?.image?`<img src="${escapeHtml(o.realItems[0].image)}">`:'<div style="width:48px;height:48px;background:#f5f5f5"></div>'}<div class="kzqc-row-info"><div class="kzqc-row-sku">${escapeHtml(o.orderNo||o.idStr)}</div><div class="kzqc-multi-summary">${escapeHtml(summary)}</div>${deadlineBadge(o)}${orderShortageNoticeHtml(o)}</div><div class="kzqc-row-count wide">${(o.realItems||[]).length} SKU<br>1 ped</div>${expanded?`<div class="kzqc-multiple-components">${(o.realItems||[]).map(item=>`<button class="kzqc-component-row" data-component-sku="${escapeHtml(item.sku)}" data-order-id="${escapeHtml(o.idStr)}">${item.image?`<img src="${escapeHtml(item.image)}">`:'<span></span>'}<span><b>${escapeHtml(item.sku)}</b><small>${enrichedTitleHtml(item)}</small></span><em>${Number(item.qty||0)}×</em></button>`).join('')}</div>`:''}</div>`}).join(''):'<div class="kzqc-empty">Nenhum pedido de Múltiplos Itens.</div>';

    const session=state.checkoutSession;const sessionProgress=checkoutProgress(session);
    const canPrintScannedOnly=session&&session.category==='single1'&&session.required?.length===1&&sessionProgress.scanned>0&&!sessionProgress.complete;
    const sessionHtml=session?`<div class="kzqc-session"><div class="kzqc-session-head"><div><div class="kzqc-session-order">${session.ordersCount>1?`${session.ordersCount} pedidos iguais`:`Pedido ${escapeHtml(session.orderNo||session.orderId)}`}</div><div style="font-size:11px;color:#8c8c8c;margin-top:3px">${session.category==='singleMany'?'Item Único (quant. > 1)':session.category==='single1'?'Item Único (quant. = 1) — conferência por bipagem':'Múltiplos Itens'}</div></div><div class="kzqc-session-progress">${sessionProgress.scanned}/${sessionProgress.total}</div></div>${session.required.map(item=>`<div class="kzqc-session-item ${item.scanned>=item.qty?'done':item.scanned>0?'partial':''}">${item.image?`<img src="${escapeHtml(item.image)}">`:'<div style="width:36px;height:36px;background:#f5f5f5"></div>'}<div><div class="kzqc-row-sku">${escapeHtml(item.sku)}</div><div class="kzqc-row-name">${escapeHtml(item.title||'Produto')}</div></div><div class="kzqc-session-qty">${item.scanned}/${item.qty}</div></div>`).join('')}<div class="kzqc-session-actions">${canPrintScannedOnly?`<button id="kzqc-print-scanned-only" class="primary" ${session.status==='printing'?'disabled':''}>Imprimir apenas os lidos (${sessionProgress.scanned})</button>`:''}<button id="kzqc-session-abnormal" class="danger" ${session.status==='printing'?'disabled':''}>Marcar pedido como anormal</button><button id="kzqc-cancel-checkout" ${session.status==='printing'?'disabled':''}>Cancelar checkout</button></div></div>`:'';
    const skuQueue=aggregateSkuQueue();
    const warehouseOptions=[...new Set(state.orders.map(o=>o.warehouseName).filter(Boolean))].sort((a,b)=>warehouseDisplayName(a).localeCompare(warehouseDisplayName(b),'pt-BR'));
    const marketplaceChannels=availableChannels();
    const marketplaceOrderCount=marketplaceChannels.reduce((sum,channel)=>sum+channel.count,0);
    panel.innerHTML=`<div class="kzqc-header"><div class="kzqc-brand-wrap"><div class="kzqc-logo-mark">${KRYZER_LOGO_URL?`<img src="${escapeHtml(KRYZER_LOGO_URL)}" alt="Kryzer">`:'K'}</div><div><div class="kzqc-title">Checkout por produto</div><div class="kzqc-version">Kryzer Checkout · v${VERSION}</div></div></div><div class="kzqc-header-actions"><div class="kzqc-plugin-pill ${state.agentOnline?'online':''}"><span></span>${state.agentOnline?'Plugin conectado':'Plugin desconectado'}</div>${FULLSCREEN_MODE?'<button id="kzqc-close-fullscreen" class="kzqc-close-btn" title="Fechar">×</button>':`<button id="kzqc-minimize">${state.minimized?'▢':'—'}</button>`}</div></div>${state.minimized?'':`<div class="kzqc-body"><aside class="kzqc-sidebar"><div class="kzqc-sidebar-section"><div class="kzqc-section-title">Configuração</div><label class="kzqc-label">Impressora</label><select id="kzqc-printer" class="kzqc-select" ${state.agentOnline?'':'disabled'}><option value="">Selecione...</option>${printerOptions}</select><button id="kzqc-agent-refresh" class="kzqc-side-action">Reconectar plugin</button></div><div class="kzqc-sidebar-section kzqc-priority-card"><div class="kzqc-section-title">Prioridade</div><div class="kzqc-fast-filters"><button id="kzqc-today-filter" class="${state.filters?.onlyToday?'active':''}">Vence hoje</button><button id="kzqc-priority-filter" class="${state.filters?.priorityFirst!==false?'active':''}">Prazo primeiro</button></div></div><div class="kzqc-sidebar-section"><div class="kzqc-section-title">Canais</div><div class="kzqc-channel-filters"><button class="kzqc-filter-btn ${Object.keys(channelSelectionMap()).length===0?'active':''}" data-channel="all"><span class="kzqc-all-channels">Todos</span></button>${CHANNELS.map(c=>`<button class="kzqc-filter-btn kzqc-logo-filter ${channelSelectionMap()[c.id]?'active':''}" data-channel="${c.id}" title="${escapeHtml(c.label)}">${channelButtonContent(c)}</button>`).join('')}</div></div><div class="kzqc-sidebar-section"><div class="kzqc-section-title">Múltiplos Itens</div>${switchToggleHtml('kzqc-bulk-toggle',state.bulkMassPrintEnabled,'Agrupar kits repetidos','Quando ligado, agrupa pedidos de kit idênticos e oferece imprimir tudo junto.')}</div>${state.lastPrinted?`<div class="kzqc-last"><div class="kzqc-last-title">Último impresso</div><div class="kzqc-last-body">${state.lastPrinted.image?`<img src="${escapeHtml(state.lastPrinted.image)}">`:'<div class="kzqc-last-placeholder"></div>'}<div class="kzqc-last-copy"><div class="kzqc-row-sku">${escapeHtml(state.lastPrinted.sku)}</div><div class="kzqc-row-name" title="${escapeHtml(state.lastPrinted.title||'')}">${escapeHtml(state.lastPrinted.title||'')}</div><div class="kzqc-last-orders">${escapeHtml((state.lastPrinted.orderNos||[]).slice(0,3).join(', '))}</div></div><div class="kzqc-last-qty">${Number(state.lastPrinted.quantity||0)}</div></div></div>`:''}<div class="kzqc-sidebar-section"><div class="kzqc-section-title">Ações</div><button id="kzqc-refresh" class="kzqc-side-action primary" ${state.refreshing||session?'disabled':''}>${state.refreshing?'Atualizando...':'Atualizar pedidos'}</button><button id="kzqc-separation-order" class="kzqc-side-action">Criar ordem de separação</button><button id="kzqc-history-button" class="kzqc-side-action">Impressos e reimpressão <b>${(state.printHistory||[]).length}</b></button><button id="kzqc-abnormal-button" class="kzqc-side-action">Pedidos anormais <b>${state.abnormalIds.length}</b></button><button id="kzqc-clear-print-blocks" class="kzqc-side-action" title="Limpa qualquer pedido preso em 'aguardando marcação' ou 'impressão em andamento' e atualiza a lista.">Limpar impressos pendentes</button><button id="kzqc-system-logs" class="kzqc-side-action">Logs do sistema <b>${(state.systemLogs||[]).length}</b></button><button id="kzqc-stock-shortage-button" class="kzqc-side-action" title="SKUs marcados sem estoque via -SKU*quantidade no campo de leitura.">Produtos sem estoque <b>${Object.keys(state.stockShortages||{}).length}</b></button></div>${FULLSCREEN_MODE?'':'<button id="kzqc-open-fullscreen">Abrir checkout em tela grande</button>'}</aside><main class="kzqc-main"><section class="kzqc-top-card"><div class="kzqc-top-copy"><div class="kzqc-eyebrow">Leitura rápida</div><h1>Escaneie o SKU para iniciar</h1><p>Os pedidos são separados por composição e impressos pelo plugin oficial do UpSeller.</p></div><div class="kzqc-queue-chip">Origem: Etiqueta não impressa</div><div class="kzqc-scan-wrap"><div class="kzqc-scan-icon">⌁</div><input id="kzqc-scanner" autocomplete="off" placeholder="Escanear ou inserir SKU" ${state.loading?'disabled':''}><div class="kzqc-enter-key">ENTER</div></div><div class="kzqc-message ${state.messageType}">${escapeHtml(state.message)}</div></section><section class="kzqc-work-card"><div class="kzqc-tabs"><button class="kzqc-tab ${state.activeTab==='single1'?'active':''}" data-tab="single1"><span>Item Único</span><small>Quantidade = 1</small><b>${categoryCounts.single1}</b></button><button class="kzqc-tab ${state.activeTab==='singleMany'?'active':''}" data-tab="singleMany"><span>Item Único</span><small>Quantidade &gt; 1</small><b>${categoryCounts.singleMany}</b></button><button class="kzqc-tab ${state.activeTab==='multiple'?'active':''}" data-tab="multiple"><span>Múltiplos Itens</span><small>Mais de um SKU</small><b>${categoryCounts.multiple}</b></button></div>${categoryCounts.unknown?`<div id="kzqc-analysis-warning" class="kzqc-message warn" data-order-ids="${escapeHtml(unknownAnalysisIds.join('\n'))}" title="${escapeHtml(unknownAnalysisIds.length?unknownAnalysisIds.join(', '):'ID não identificado — consulte os logs')}">${categoryCounts.unknown} pedido(s) aguardando análise da composição.</div>`:''}<div class="kzqc-content-head"><div><div class="kzqc-content-title">${state.activeTab==='single1'?'Pedidos de item único':state.activeTab==='singleMany'?'Pedidos com várias unidades':'Pedidos com múltiplos itens'}</div><div class="kzqc-content-subtitle">1 clique abre ações; 2 cliques rápidos equivalem à bipagem.</div></div><div class="kzqc-total-pill">${state.activeTab==='single1'?single1Orders.length:state.activeTab==='singleMany'?singleManyOrders.length:multipleOrders.length} registros</div></div>${sessionHtml||`<div class="kzqc-list">${listHtml}</div>`}${state.pending?.orderIds?.length?`<div class="kzqc-pending"><b>${state.pending.orderIds.length} pedido(s) já impresso(s)</b><br>Falta confirmar a marcação.<button id="kzqc-retry-mark">Tentar marcar novamente</button></div>`:''}${state.unknownPrint?.orderIds?.length?`<div class="kzqc-pending kzqc-unknown-print"><b>${state.unknownPrint.orderIds.length} pedido(s) com impressão sem confirmação</b><br>A etiqueta pode ter saído. Confira fisicamente antes de escolher.<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px"><button id="kzqc-unknown-mark">A etiqueta saiu — marcar</button><button id="kzqc-unknown-release" style="background:#64748b">A etiqueta não saiu — liberar</button></div></div>`:''}${state.stuckVoidedOrders?.length?`<div class="kzqc-pending kzqc-unknown-print"><b>${state.stuckVoidedOrders.length} pedido(s) com produto trocado, presos em Anulado</b><br>A troca de produto foi aplicada, mas não consegui redefinir automaticamente: ${escapeHtml(state.stuckVoidedOrders.map(e=>e.orderNo).join(', '))}.<button id="kzqc-retry-stuck-voided" style="margin-top:8px">Tentar redefinir novamente</button></div>`:''}</section></main><aside class="kzqc-right-queue"><div class="kzqc-right-head"><div class="kzqc-right-title">SKUs para separar</div><button id="kzqc-scope-toggle" class="kzqc-scope-toggle ${state.skuFilters?.currentTabOnly!==false?'active':''}" type="button" title="Ativado: mostra somente a aba atual. Desativado: soma todas as categorias.">${state.skuFilters?.currentTabOnly!==false?'Somente esta aba':'Todas as abas'}</button><button id="kzqc-rename-warehouses" type="button">Renomear armazéns</button></div><input id="kzqc-sku-filter" class="kzqc-sku-search" placeholder="Filtrar por SKU, nome ou use % como coringa" value="${escapeHtml(state.skuFilters?.query||'')}"><div class="kzqc-warehouse-filters"><button class="kzqc-warehouse-btn ${(state.skuFilters?.warehouses||[]).length===0?'active':''}" data-warehouse="__ALL__">Todos armazéns</button>${warehouseOptions.map(name=>`<button class="kzqc-warehouse-btn ${(state.skuFilters?.warehouses||[]).includes(name)?'active':''}" data-warehouse="${escapeHtml(name)}">${escapeHtml(warehouseDisplayName(name))}</button>`).join('')}</div><div class="kzqc-queue-help"><strong>Pesquisa:</strong> ignora acentos e aceita <b>%</b> como coringa. Ex.: <b>5%06</b>.</div><div class="kzqc-sku-queue-list">${skuQueue.length?skuQueue.map(row=>`<button class="kzqc-sku-queue-row" data-abnormal-sku="${escapeHtml(row.sku)}" data-order-count="${row.orders}" data-search="${escapeHtml(`${row.sku} ${row.title||''} ${(row.warehouses||[]).map(warehouseDisplayName).join(' ')}`)}" title="Marcar ${escapeHtml(row.sku)} como anormal">${row.image?`<img src="${escapeHtml(row.image)}">`:'<span class="kzqc-img-placeholder"></span>'}<span class="kzqc-sku-queue-copy"><b>${escapeHtml(row.sku)}</b><small>${escapeHtml(row.title||'')}</small><em>${escapeHtml((row.warehouses||[]).map(warehouseDisplayName).join(' · '))}</em></span><span class="kzqc-sku-queue-qty">${row.qty}</span></button>`).join(''):'<div class="kzqc-empty">Nenhum SKU.</div>'}</div></aside></div>`}`;
    const analysisWarning=panel.querySelector('#kzqc-analysis-warning');
    if(analysisWarning){
      analysisWarning.ondblclick=async()=>{
        const text=norm(analysisWarning.dataset.orderIds||unknownAnalysisIds.join('\n'));
        if(!text){setMessage('Não foi possível identificar o ID. Abra os logs e procure por pedido_categoria_desconhecida.', 'error');scheduleRender();return;}
        try{await navigator.clipboard.writeText(text);setMessage(`${text.split('\n').filter(Boolean).length} ID(s) copiado(s).`, 'success');}
        catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();setMessage(`${text.split('\n').filter(Boolean).length} ID(s) copiado(s).`, 'success');}
        scheduleRender();
      };
    }
    panel.querySelector('#kzqc-unknown-mark')?.addEventListener('click',()=>resolveUnknownPrint('mark'));
    panel.querySelector('#kzqc-unknown-release')?.addEventListener('click',()=>resolveUnknownPrint('release'));
    panel.querySelector('#kzqc-retry-stuck-voided')?.addEventListener('click',retryStuckVoided);
    const channelSection=[...panel.querySelectorAll('.kzqc-sidebar-section')].find(section=>section.querySelector('.kzqc-section-title')?.textContent.trim()==='Canais');
    if(channelSection){
      const channelSelection=channelSelectionMap();
      const marketplaceBar=document.createElement('div');
      marketplaceBar.className='kzqc-marketplace-bar';
      marketplaceBar.innerHTML=`<span class="kzqc-marketplace-label">Marketplaces</span><button class="kzqc-filter-btn ${Object.keys(channelSelection).length===0?'active':''}" data-channel="all">Todos <span class="kzqc-marketplace-count">${marketplaceOrderCount}</span></button>${marketplaceChannels.map(channel=>{
        const sel=channelSelection[channel.id];
        const stores=storesForChannel(channel.id);
        const selectedStores=Array.isArray(sel)?new Set(sel):new Set();
        return `<div class="kzqc-marketplace-item"><button class="kzqc-filter-btn ${sel?'active':''}" data-channel="${escapeHtml(channel.id)}" title="${escapeHtml(channel.label)}">${channelButtonContent(channel)} <span class="kzqc-marketplace-count">${channel.count}</span></button>${stores.length?`<div class="kzqc-store-dropdown"><div class="kzqc-store-dropdown-title">${escapeHtml(channel.label)}</div>${stores.map(store=>`<button class="kzqc-store-dropdown-item ${selectedStores.has(store.name)?'active':''}" data-channel="${escapeHtml(channel.id)}" data-shop="${escapeHtml(store.name)}">${escapeHtml(store.name)}<span>${store.count}</span></button>`).join('')}</div>`:''}</div>`;
      }).join('')}`;
      panel.querySelector('.kzqc-top-card')?.insertAdjacentElement('afterend',marketplaceBar);
      channelSection.remove();
    }
    panel.querySelector('#kzqc-minimize')?.addEventListener('click',()=>{state.minimized=!state.minimized;saveJson(STORAGE_UI,{minimized:state.minimized,activeTab:state.activeTab});renderPanel()});
    panel.querySelector('#kzqc-close-fullscreen')?.addEventListener('click',()=>window.close()); panel.querySelector('#kzqc-open-fullscreen')?.addEventListener('click',()=>window.open('/pt/order/in-process?kzCheckout=1','_blank'));
    if(state.minimized)return;
    const scanner=panel.querySelector('#kzqc-scanner'); if(scanner&&previousScannerValue)scanner.value=previousScannerValue; scanner?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleScan(scanner.value).catch(error => { console.error('[KZ Checkout] erro ao processar leitura', error); setMessage('Falha ao consultar o código de barras.', 'error'); beep(false); focusScanner(); })}});
    panel.querySelector('#kzqc-printer')?.addEventListener('change',e=>{state.printer=e.target.value;localStorage.setItem(STORAGE_PRINTER,state.printer);try{if(pluginSocket?.readyState===WebSocket.OPEN)pluginSend('changePrinter',[state.printer])}catch{}focusScanner()});
    panel.querySelector('#kzqc-history-button')?.addEventListener('click',showHistoryModal); panel.querySelector('#kzqc-abnormal-button')?.addEventListener('click',showAbnormalModal); panel.querySelector('#kzqc-stock-shortage-button')?.addEventListener('click',showStockShortageModal);
    panel.querySelectorAll('.kzqc-marketplace-bar .kzqc-filter-btn[data-channel]').forEach(b=>b.onclick=()=>{
      const c=b.dataset.channel;
      const selection={...channelSelectionMap()};
      if(c==='all'){ state.filters.channelSelection={}; }
      else if(selection[c]==='all'){ delete selection[c]; state.filters.channelSelection=selection; }
      else { selection[c]='all'; state.filters.channelSelection=selection; }
      saveJson(STORAGE_FILTERS,state.filters);renderPanel();
    });
    panel.querySelectorAll('.kzqc-store-dropdown-item').forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      const channelId=b.dataset.channel, shopName=b.dataset.shop;
      const selection={...channelSelectionMap()};
      let list=Array.isArray(selection[channelId])?[...selection[channelId]]:[];
      if(list.includes(shopName))list=list.filter(name=>name!==shopName);
      else list=[...list,shopName];
      if(list.length)selection[channelId]=list;
      else delete selection[channelId];
      state.filters.channelSelection=selection;
      saveJson(STORAGE_FILTERS,state.filters);renderPanel();
    });
    panel.querySelector('#kzqc-today-filter')?.addEventListener('click',()=>{state.filters.onlyToday=!state.filters.onlyToday;saveJson(STORAGE_FILTERS,state.filters);renderPanel()}); panel.querySelector('#kzqc-priority-filter')?.addEventListener('click',()=>{state.filters.priorityFirst=state.filters.priorityFirst===false;saveJson(STORAGE_FILTERS,state.filters);renderPanel()}); panel.querySelector('#kzqc-bulk-toggle')?.addEventListener('change',e=>{state.bulkMassPrintEnabled=e.target.checked;saveJson(STORAGE_BULK_MASS_PRINT,state.bulkMassPrintEnabled);renderPanel()});
    panel.querySelectorAll('.kzqc-tab').forEach(b=>b.onclick=()=>{if(state.checkoutSession||state.loading)return;state.activeTab=b.dataset.tab;saveJson(STORAGE_UI,{minimized:state.minimized,activeTab:state.activeTab});renderPanel();focusScanner()});
    panel.querySelectorAll('.kzqc-row').forEach(row=>{
      const order=findOrderById(row.dataset.orderId);
      if(!order)return;
      // Alt+Click abre o modal de trocar produto do pedido, direto na lista, sem
      // precisar navegar pelo Anular/Editar/Redefinir nativo do UpSeller.
      row.addEventListener('click',event=>{
        if(!event.altKey)return;
        event.stopImmediatePropagation();
        event.preventDefault();
        openProductChangeModal(order);
      });
      if(row.dataset.kind==='multipleOrder'){
        row.addEventListener('click',e=>{if(e.target.closest('.kzqc-component-row'))return;state.expandedMultipleId=state.expandedMultipleId===order.idStr?'':order.idStr;renderPanel()});
      }else{
        bindSingleDoubleClick(row,()=>showOrderAbnormalModal(order,row.dataset.sku||''),()=>handleScan(row.dataset.sku||''));
      }
    });
    panel.querySelectorAll('.kzqc-component-row').forEach(btn=>{
      const order=findOrderById(btn.dataset.orderId); const sku=btn.dataset.componentSku;
      bindSingleDoubleClick(btn,()=>showOrderAbnormalModal(order,sku),()=>{if(!state.checkoutSession)startCheckout(order);setTimeout(()=>handleScan(sku),40)});
    });
    panel.querySelector('#kzqc-cancel-checkout')?.addEventListener('click',cancelCheckout); panel.querySelector('#kzqc-session-abnormal')?.addEventListener('click',()=>{const orders=(state.checkoutSession?.orderIds||[]).map(findOrderById).filter(Boolean);state.checkoutSession=null;markOrdersAbnormal(orders)}); panel.querySelector('#kzqc-print-scanned-only')?.addEventListener('click',printOnlyScanned);
    panel.querySelector('#kzqc-refresh')?.addEventListener('click',()=>requestOrdersRefresh(true)); panel.querySelector('#kzqc-agent-refresh')?.addEventListener('click',refreshAgent); panel.querySelector('#kzqc-separation-order')?.addEventListener('click',showSeparationOrderModal); panel.querySelector('#kzqc-retry-mark')?.addEventListener('click',retryPendingMark); panel.querySelector('#kzqc-clear-print-blocks')?.addEventListener('click',clearAllPrintBlocks); panel.querySelector('#kzqc-system-logs')?.addEventListener('click',showSystemLogsModal);
    panel.querySelectorAll('.kzqc-overdue-row').forEach(b=>b.onclick=()=>{
      const order=findOrderById(b.dataset.orderId);
      if(!order){setMessage('Pedido atrasado não encontrado na lista atual (pode ter sido separado em outra aba/computador).','error');return;}
      if(!order.realItems?.length){setMessage(`Pedido ${order.orderNo||order.idStr} está atrasado mas a composição não pôde ser analisada — confira e separe manualmente pelo site do UpSeller.`,'error');return;}
      if(order.category&&order.category!=='unknown')state.activeTab=order.category;
      startCheckout(order);
    });
    const toggleSkuScope=()=>{state.skuFilters.currentTabOnly=state.skuFilters.currentTabOnly===false;saveJson(STORAGE_SKU_FILTERS,state.skuFilters);renderPanel()};
    panel.querySelector('#kzqc-scope-toggle')?.addEventListener('click',toggleSkuScope);
    const queueTitle=panel.querySelector('.kzqc-right-title');if(queueTitle){queueTitle.style.cursor='pointer';queueTitle.title='Alternar entre esta aba e todas as abas';queueTitle.addEventListener('click',toggleSkuScope)}
    const skuFilter=panel.querySelector('#kzqc-sku-filter'); skuFilter?.addEventListener('input',e=>{state.skuFilters.query=e.target.value;saveJson(STORAGE_SKU_FILTERS,state.skuFilters);applySkuQueueSearch(panel);}); applySkuQueueSearch(panel);
    panel.querySelectorAll('.kzqc-warehouse-btn').forEach(b=>b.onclick=()=>{if(b.dataset.warehouse==='__ALL__')state.skuFilters.warehouses=[];else{const set=new Set(state.skuFilters.warehouses||[]);set.has(b.dataset.warehouse)?set.delete(b.dataset.warehouse):set.add(b.dataset.warehouse);state.skuFilters.warehouses=[...set]}saveJson(STORAGE_SKU_FILTERS,state.skuFilters);renderPanel()});
    panel.querySelector('#kzqc-rename-warehouses')?.addEventListener('click',showWarehouseRenameModal);
    panel.querySelectorAll('[data-abnormal-sku]').forEach(b=>b.onclick=()=>showSkuAbnormalModal(b.dataset.abnormalSku,Number(b.dataset.orderCount||1)));
    let imagePreview=document.getElementById('kzqc-image-preview');
    if(!imagePreview){imagePreview=document.createElement('div');imagePreview.id='kzqc-image-preview';imagePreview.innerHTML='<img alt="Prévia do produto">';document.body.appendChild(imagePreview)}
    const movePreview=event=>{const size=220;const gap=16;let left=event.clientX+gap,top=event.clientY+gap;if(left+size>innerWidth)left=event.clientX-size-gap;if(top+size>innerHeight)top=event.clientY-size-gap;imagePreview.style.left=Math.max(8,left)+'px';imagePreview.style.top=Math.max(8,top)+'px'};
    panel.querySelectorAll('.kzqc-sku-queue-row img,.kzqc-row img,.kzqc-component-row img').forEach(image=>{
      image.addEventListener('mouseenter',event=>{imagePreview.querySelector('img').src=image.src;imagePreview.style.display='block';movePreview(event)});
      image.addEventListener('mousemove',movePreview);
      image.addEventListener('mouseleave',()=>{imagePreview.style.display='none';imagePreview.querySelector('img').removeAttribute('src')});
    });
    const newList=panel.querySelector('.kzqc-list');if(newList){if(!restoreListAnchor(newList,previousListAnchor))newList.scrollTop=previousListScroll;}if(scannerWasFocused&&!state.loading)setTimeout(focusScanner,30);updateCountdowns();clearInterval(countdownTimer);countdownTimer=setInterval(updateCountdowns,1000);
window.scrollTo(previousWindowScroll.x,previousWindowScroll.y);Object.entries(previousExtraScroll).forEach(([sel,pos])=>{const el=panel.querySelector(sel);if(el){el.scrollTop=pos.top;el.scrollLeft=pos.left}});
  }

  function installDrag() {
    if (FULLSCREEN_MODE) return;
    document.addEventListener('mousedown', event => {
      const header = event.target.closest?.('#kzqc-panel .kzqc-header');
      if (!header || event.target.closest('button')) return;
      const panel = document.getElementById('kzqc-panel');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;

      const move = moveEvent => {
        panel.style.left = Math.max(0, startLeft + moveEvent.clientX - startX) + 'px';
        panel.style.top = Math.max(0, startTop + moveEvent.clientY - startY) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      event.preventDefault();
    });
  }

  function init() {
    installDrag();
    try {
      unsafeWindow.KZCheckoutRapido = {
        versao: VERSION,
        diagnostico() {
          const compact = state.orders.map(order => ({
            pedido: order.orderNo,
            id: order.idStr,
            categoria: order.category,
            verificado: order.verified,
            canal: order.channel,
            prazo: order.deadlineAt,
            itens: order.realItems,
            origemComposicao: order.componentMeta?.path || '',
            caminhosSku: order.componentMeta?.skuPaths || [],
          }));
          console.table(compact.map(row => ({ pedido: row.pedido, categoria: row.categoria, verificado: row.verificado, canal: row.canal, origem: row.origemComposicao, itens: row.itens.map(i => `${i.qty}x${i.sku}`).join(' + ') })));
          return compact;
        },
        diagnosticoKits() {
          const rows = state.orders.map(order => ({
            pedido: order.orderNo,
            categoria: order.category,
            verificado: order.verified,
            skuAnuncio: order.marketplaceItems?.map(i => `${i.qty}x${i.sku}`).join(' + ') || '',
            skuArmazem: order.realItems?.map(i => `${i.qty}x${i.sku}`).join(' + ') || '',
            origem: order.componentMeta?.path || '',
            caminhos: order.componentMeta?.skuPaths || [],
          }));
          console.table(rows);
          return rows;
        },
        limparCacheKits() { skuDetailCache.clear(); return requestOrdersRefresh(true); },
        reconectarPlugin() { return refreshAgent(); },
        abrirTelaGrande() { return window.open('/pt/order/in-process?kzCheckout=1', '_blank'); },
      };
    } catch {}

    let runtimeStarted = false;
    const startRuntime = () => {
      if (runtimeStarted || (!FULLSCREEN_MODE && !isOrdersRoute())) return;
      runtimeStarted = true;
      refreshAgent();
      setTimeout(async () => {
        await requestOrdersRefresh(false);
        setTimeout(focusScanner, 80);
      }, 1200);

      refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !state.loading && !state.checkoutSession && !document.getElementById('kzqc-modal')) {
          requestOrdersRefresh(false);
        }
      }, REFRESH_INTERVAL_MS);

      agentTimer = setInterval(refreshAgent, 20000);
    };

    const syncRouteUi = () => {
      if (!document.body) return;
      renderPanel();
      if (FULLSCREEN_MODE || isOrdersRoute()) startRuntime();
    };

    const installRouteWatcher = () => {
      if (window.__KZ_CHECKOUT_ROUTE_WATCHER__) return;
      window.__KZ_CHECKOUT_ROUTE_WATCHER__ = true;
      let lastHref = location.href;
      const check = () => {
        if (location.href !== lastHref) { lastHref = location.href; syncRouteUi(); }
        else if (!FULLSCREEN_MODE && isOrdersRoute() && !document.getElementById('kzqc-panel')) syncRouteUi();
        else if (!FULLSCREEN_MODE && !isOrdersRoute() && document.getElementById('kzqc-panel')) syncRouteUi();
      };
      const push = history.pushState, replace = history.replaceState;
      history.pushState = function(...args){ const r=push.apply(this,args); queueMicrotask(syncRouteUi); return r; };
      history.replaceState = function(...args){ const r=replace.apply(this,args); queueMicrotask(syncRouteUi); return r; };
      addEventListener('popstate',syncRouteUi); addEventListener('hashchange',syncRouteUi);
      new MutationObserver(check).observe(document.documentElement,{childList:true,subtree:true});
      setInterval(check,500);
    };

    const startUi = () => {
      if (!document.body) return setTimeout(startUi,20);
      installRouteWatcher();
      syncRouteUi();
    };
    startUi();
  }

  init();
}

try {
  initCheckoutModule();
} catch (e) {
  console.warn('[Kryzer Agent] erro ao iniciar módulo initCheckoutModule:', e);
}
