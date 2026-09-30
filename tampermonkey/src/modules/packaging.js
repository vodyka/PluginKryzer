// =========================================================================
// MODULE: packaging
// Google Sheets packaging + fulfillment operation tracking for Kryzer Checkout.
// This module is deliberately isolated from the UpSeller Print Plugin.
// =========================================================================
(function initKryzerPackagingModule() {
  'use strict';

  if (globalThis.KryzerPackaging) return;

  const VERSION = '0.1.3';
  const API_URL = 'https://script.google.com/macros/s/AKfycbyLfRSbW_MwqOP-6vNQRO-hpJ9rFEQdvm_lxO2dsEpYGLtC390Vrq_JwItCIL1BlAzY8A/exec';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Je79NTOUZEEwC7FE9P5bapuuZme76vwM_E7jDg-a8dI/edit';
  const PACKAGING_GID = '1120907586';
  const MAPPING_GID = '34233941';

  const KEY_CONFIG = 'kz_packaging_config_v1';
  const KEY_CACHE = 'kz_packaging_bootstrap_cache_v1';
  const KEY_QUEUE = 'kz_packaging_sync_queue_v1';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_QUEUE = 3000;

  const DEFAULT_CONFIG = {
    enabled: false,
    token: '',
    endpoint: API_URL,
  };

  let bootstrapPromise = null;
  let flushPromise = null;
  let injectTimer = null;
  let scannerAutofillGuard = null;

  function releaseScannerAutofillGuard() {
    const guard = scannerAutofillGuard;
    scannerAutofillGuard = null;
    if (!guard) return;
    clearInterval(guard.timer);
    const input = guard.input;
    if (!input || !input.isConnected) return;
    input.readOnly = guard.readOnly;
    if (guard.autocomplete == null) input.removeAttribute('autocomplete');
    else input.setAttribute('autocomplete', guard.autocomplete);
    // Enquanto o modal está aberto o scanner fica coberto pela overlay, então
    // qualquer alteração nele é autofill do navegador/password manager.
    if (input.value !== guard.value) input.value = guard.value;
  }

  function protectScannerFromCredentialAutofill() {
    releaseScannerAutofillGuard();
    const input = document.getElementById('kzqc-scanner');
    if (!input) return;
    const guard = {
      input,
      value: input.value,
      readOnly: input.readOnly,
      autocomplete: input.getAttribute('autocomplete'),
      timer: null,
    };
    try { input.blur(); } catch {}
    input.readOnly = true;
    input.setAttribute('autocomplete', 'one-time-code');
    guard.timer = setInterval(() => {
      if (!document.getElementById('kzpkg-modal') || !input.isConnected) {
        releaseScannerAutofillGuard();
        return;
      }
      if (input.value !== guard.value) input.value = guard.value;
    }, 80);
    scannerAutofillGuard = guard;
  }

  const nowIso = () => new Date().toISOString();
  const norm = value => String(value == null ? '' : value).trim();
  const normSku = value => norm(value).toUpperCase();
  const money = value => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';
  };
  const escapeHtml = value => norm(value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  })[ch]);

  function getConfig() {
    try {
      const value = GM_getValue(KEY_CONFIG, DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, ...(value || {}), endpoint: API_URL };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(next) {
    const value = { ...getConfig(), ...(next || {}), endpoint: API_URL };
    GM_setValue(KEY_CONFIG, value);
    updateSidebarButton();
    return value;
  }

  function getCache() {
    try {
      const value = GM_getValue(KEY_CACHE, null);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function saveCache(data) {
    const value = {
      at: Date.now(),
      generatedAt: data?.generatedAt || nowIso(),
      packaging: Array.isArray(data?.packaging) ? data.packaging : [],
      skuMappings: Array.isArray(data?.skuMappings) ? data.skuMappings : [],
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
    };
    GM_setValue(KEY_CACHE, value);
    updateSidebarButton();
    return value;
  }

  function getQueue() {
    try {
      const value = GM_getValue(KEY_QUEUE, []);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveQueue(queue) {
    GM_setValue(KEY_QUEUE, (queue || []).slice(-MAX_QUEUE));
    updateSidebarButton();
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        timeout: options.timeout || 15000,
        anonymous: false,
        onload: response => {
          const text = norm(response.responseText);
          let json = null;
          try { json = text ? JSON.parse(text) : {}; }
          catch {
            reject(new Error('Resposta inválida do Google Apps Script.'));
            return;
          }
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(json?.error || `Google Sheets HTTP ${response.status}`));
            return;
          }
          if (json?.ok === false) {
            reject(new Error(json.error || 'Google Sheets recusou a operação.'));
            return;
          }
          resolve(json || {});
        },
        onerror: () => reject(new Error('Falha de rede ao acessar o Google Sheets.')),
        ontimeout: () => reject(new Error('Tempo esgotado ao acessar o Google Sheets.')),
      });
    });
  }

  async function apiGet(action, tokenOverride) {
    const token = norm(tokenOverride != null ? tokenOverride : getConfig().token);
    if (!token) throw new Error('Token da integração de embalagens não configurado.');
    const url = `${API_URL}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}&_=${Date.now()}`;
    return await gmRequest({ method: 'GET', url });
  }

  async function apiPost(payload, tokenOverride) {
    const token = norm(tokenOverride != null ? tokenOverride : getConfig().token);
    if (!token) throw new Error('Token da integração de embalagens não configurado.');
    return await gmRequest({
      method: 'POST',
      url: API_URL,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      data: JSON.stringify({ ...(payload || {}), token }),
    });
  }

  async function bootstrap(force = false, tokenOverride) {
    const cached = getCache();
    if (!force && cached && Date.now() - Number(cached.at || 0) < CACHE_TTL_MS) return cached;
    if (bootstrapPromise && tokenOverride == null) return bootstrapPromise;

    const task = (async () => {
      try {
        const data = await apiGet('bootstrap', tokenOverride);
        return saveCache(data);
      } catch (error) {
        if (cached?.packaging?.length) {
          console.warn('[KZ Packaging] usando cache local:', error);
          return cached;
        }
        throw error;
      }
    })();

    if (tokenOverride == null) bootstrapPromise = task;
    try { return await task; }
    finally { if (tokenOverride == null) bootstrapPromise = null; }
  }

  function activePackaging(cache) {
    return (cache?.packaging || []).filter(row => row && row.id && row.active !== false);
  }

  function mappingForSku(cache, sku) {
    const target = normSku(sku);
    if (!target) return null;
    return (cache?.skuMappings || []).find(row => normSku(row?.sku) === target) || null;
  }

  function packagingById(cache, id) {
    const target = norm(id);
    return activePackaging(cache).find(row => norm(row?.id) === target) || null;
  }

  function normalizeItems(order) {
    const source = Array.isArray(order?.realItems) && order.realItems.length
      ? order.realItems
      : Array.isArray(order?.marketplaceItems) ? order.marketplaceItems : [];
    return source.map(item => ({
      sku: normSku(item?.sku || item?.productSku),
      title: norm(item?.title || item?.productName || item?.name),
      qty: Math.max(1, Number(item?.qty || item?.quantity || item?.productCount || 1) || 1),
    })).filter(item => item.sku);
  }

  function analyzeOrders(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const allSingle = list.length > 0 && list.every(order =>
      order?.category === 'single1' || order?.category === 'singleMany'
    );
    const firstSkus = list.map(order => normalizeItems(order)[0]?.sku || normSku(order?.sku)).filter(Boolean);
    const uniqueSkus = [...new Set(firstSkus)];
    const eachOneSku = list.every(order => normalizeItems(order).length <= 1);
    const fixedEligible = allSingle && eachOneSku && uniqueSkus.length === 1;
    return {
      fixedEligible,
      sku: fixedEligible ? uniqueSkus[0] : '',
      title: fixedEligible ? norm(list[0]?.title || normalizeItems(list[0])[0]?.title) : '',
      manualRequired: !fixedEligible,
      orderCount: list.length,
      categories: [...new Set(list.map(order => norm(order?.category)).filter(Boolean))],
    };
  }

  function ensureStyles() {
    if (document.getElementById('kzpkg-style')) return;
    const css = `
      #kzpkg-modal{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
      #kzpkg-modal .kzpkg-card{width:min(760px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.28);padding:22px;color:#262626}
      #kzpkg-modal .kzpkg-title{font-size:19px;font-weight:700;margin-bottom:4px}
      #kzpkg-modal .kzpkg-sub{font-size:12px;color:#737373;line-height:1.5;margin-bottom:18px}
      #kzpkg-modal .kzpkg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #kzpkg-modal .kzpkg-option{display:block;border:1px solid #e5e7eb;border-radius:10px;padding:13px;cursor:pointer;background:#fff;transition:.15s}
      #kzpkg-modal .kzpkg-option:hover{border-color:#0049e5;background:#f8fbff}
      #kzpkg-modal .kzpkg-option:has(input:checked){border-color:#0049e5;background:#eef5ff;box-shadow:0 0 0 1px #0049e5 inset}
      #kzpkg-modal .kzpkg-option input{margin-right:8px}
      #kzpkg-modal .kzpkg-option b{font-size:13px}
      #kzpkg-modal .kzpkg-meta{font-size:11px;color:#737373;margin-top:6px;line-height:1.5}
      #kzpkg-modal .kzpkg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
      #kzpkg-modal button{border:1px solid #d9d9d9;background:#fff;border-radius:6px;padding:9px 14px;cursor:pointer;font-weight:600}
      #kzpkg-modal button.primary{background:#0049e5;border-color:#0049e5;color:#fff}
      #kzpkg-modal button.danger{color:#b42318}
      #kzpkg-modal input[type=password],#kzpkg-modal input[type=text],#kzpkg-modal textarea{width:100%;height:40px;border:1px solid #d9d9d9;border-radius:6px;padding:9px 10px;box-sizing:border-box;font:inherit;resize:none;overflow:hidden}
      #kzpkg-modal .kzpkg-field{margin:12px 0}
      #kzpkg-modal .kzpkg-field label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
      #kzpkg-modal .kzpkg-check{display:flex;align-items:center;gap:8px;padding:12px 2px;font-size:12px}
      #kzpkg-modal .kzpkg-status{padding:10px 12px;border-radius:8px;background:#f5f5f5;font-size:12px;line-height:1.5;margin-top:12px}
      #kzpkg-modal .kzpkg-status.ok{background:#f0fdf4;color:#166534}
      #kzpkg-modal .kzpkg-status.error{background:#fef2f2;color:#991b1b}
      #kzpkg-modal .kzpkg-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:10px 12px;font-size:12px;margin:10px 0}
      #kzpkg-modal .kzpkg-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}
      #kzpkg-modal .kzpkg-links a{font-size:12px;color:#0049e5;text-decoration:none}
      #kzpkg-modal .kzpkg-fixed-note{font-size:11px;color:#166534;background:#f0fdf4;border-radius:8px;padding:9px 11px;margin-bottom:12px}
      @media(max-width:650px){#kzpkg-modal .kzpkg-grid{grid-template-columns:1fr}}
    `;
    const style = document.createElement('style');
    style.id = 'kzpkg-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeModal() {
    document.getElementById('kzpkg-modal')?.remove();
    releaseScannerAutofillGuard();
  }

  function showSettingsModal() {
    ensureStyles();
    closeModal();
    const cfg = getConfig();
    protectScannerFromCredentialAutofill();
    const cache = getCache();
    const queue = getQueue();
    const modal = document.createElement('div');
    modal.id = 'kzpkg-modal';
    modal.innerHTML = `
      <div class="kzpkg-card">
        <div class="kzpkg-title">Embalagens e cobrança</div>
        <div class="kzpkg-sub">Integração com a planilha Kryzer Checkout. O token fica salvo somente neste navegador.</div>

        <label class="kzpkg-check">
          <input id="kzpkg-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}>
          <span><b>Ativar controle obrigatório de embalagem</b><br>Quando ativado, o checkout valida a embalagem antes de imprimir.</span>
        </label>

        <div class="kzpkg-field">
          <label>API_TOKEN do Google Apps Script</label>
          <textarea id="kzpkg-token" rows="1" readonly autocomplete="new-password" autocapitalize="off" spellcheck="false" name="kz_packaging_secret_${Date.now()}" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="Cole a chave configurada nas Propriedades do Script">${escapeHtml(cfg.token || '')}</textarea>
        </div>

        <div id="kzpkg-settings-status" class="kzpkg-status">
          Cache: ${cache ? `${activePackaging(cache).length} embalagem(ns), ${(cache.skuMappings||[]).length} SKU(s) · atualizado ${new Date(cache.at).toLocaleString('pt-BR')}` : 'ainda não carregado'}<br>
          Pendências para sincronizar: <b>${queue.length}</b>
        </div>

        <div class="kzpkg-links">
          <a href="${SHEET_URL}#gid=${PACKAGING_GID}" target="_blank" rel="noopener">Abrir cadastro de embalagens</a>
          <a href="${SHEET_URL}#gid=${MAPPING_GID}" target="_blank" rel="noopener">Abrir mapeamento de SKU</a>
          <a href="${SHEET_URL}" target="_blank" rel="noopener">Abrir planilha completa</a>
        </div>

        <div class="kzpkg-actions">
          <button id="kzpkg-close" type="button">Fechar</button>
          <button id="kzpkg-refresh" type="button">Atualizar cadastros</button>
          <button id="kzpkg-test" type="button" class="primary">Testar e salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const status = modal.querySelector('#kzpkg-settings-status');
    const tokenField = modal.querySelector('#kzpkg-token');
    // O campo nasce readonly para o Chrome não montar um par usuário/senha com
    // o scanner do checkout. Ele só é liberado por interação real do usuário.
    const unlockTokenField = event => {
      if (!event?.isTrusted) return;
      tokenField.readOnly = false;
    };
    tokenField?.addEventListener('pointerdown', unlockTokenField, { once: true });
    tokenField?.addEventListener('keydown', event => {
      if (tokenField.readOnly && event.isTrusted) tokenField.readOnly = false;
    }, { once: true });
    modal.querySelector('#kzpkg-close').onclick = closeModal;
    modal.querySelector('#kzpkg-test').onclick = async () => {
      const token = norm(modal.querySelector('#kzpkg-token').value);
      const enabled = modal.querySelector('#kzpkg-enabled').checked;
      if (!token) {
        status.className = 'kzpkg-status error';
        status.textContent = 'Informe o API_TOKEN.';
        return;
      }
      status.className = 'kzpkg-status';
      status.textContent = 'Testando conexão...';
      try {
        const fresh = await bootstrap(true, token);
        saveConfig({ token, enabled });
        status.className = 'kzpkg-status ok';
        status.textContent = `Conectado. ${activePackaging(fresh).length} embalagem(ns) e ${(fresh.skuMappings||[]).length} SKU(s) carregados.`;
        flushQueue();
      } catch (error) {
        status.className = 'kzpkg-status error';
        status.textContent = error?.message || String(error);
      }
    };
    modal.querySelector('#kzpkg-refresh').onclick = async () => {
      const token = norm(modal.querySelector('#kzpkg-token').value) || cfg.token;
      status.className = 'kzpkg-status';
      status.textContent = 'Atualizando cadastros...';
      try {
        const fresh = await bootstrap(true, token);
        status.className = 'kzpkg-status ok';
        status.textContent = `Atualizado. ${activePackaging(fresh).length} embalagem(ns), ${(fresh.skuMappings||[]).length} SKU(s).`;
      } catch (error) {
        status.className = 'kzpkg-status error';
        status.textContent = error?.message || String(error);
      }
    };
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    modal.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    modal.querySelector('#kzpkg-token')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        modal.querySelector('#kzpkg-test')?.click();
      }
    });
  }

  function choosePackagingModal(packages, analysis, mapped) {
    ensureStyles();
    closeModal();

    return new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      modal.id = 'kzpkg-modal';
      const options = packages.map((pkg, index) => {
        const dims = [pkg.lengthCm, pkg.widthCm, pkg.heightCm].map(Number);
        const dimText = dims.some(Boolean) ? `${dims[0]||0}×${dims[1]||0}×${dims[2]||0} cm` : 'medidas não informadas';
        return `
          <label class="kzpkg-option">
            <input type="radio" name="kzpkg-choice" value="${escapeHtml(pkg.id)}" ${mapped?.packagingId === pkg.id ? 'checked' : ''}>
            <b>${escapeHtml(pkg.name || pkg.id)}</b>
            <div class="kzpkg-meta">ID: ${escapeHtml(pkg.id)}${pkg.packagingSku ? ` · SKU: ${escapeHtml(pkg.packagingSku)}` : ''}<br>
            ${money(pkg.cost)} · ${Number(pkg.weightG||0)} g · ${escapeHtml(dimText)}</div>
          </label>
        `;
      }).join('');

      modal.innerHTML = `
        <div class="kzpkg-card">
          <div class="kzpkg-title">Qual embalagem foi usada?</div>
          <div class="kzpkg-sub">
            ${analysis.orderCount} pedido(s) · ${analysis.fixedEligible ? `SKU ${escapeHtml(analysis.sku)}` : 'Kit / múltiplos itens'}.
            A impressão só continua depois da escolha.
          </div>
          ${analysis.manualRequired ? '<div class="kzpkg-warn">Kit / múltiplos itens: embalagem fixa de SKU não é aplicada. Selecione a embalagem real deste pedido.</div>' : ''}
          ${mapped?.packagingId && analysis.fixedEligible ? `<div class="kzpkg-fixed-note">Existe um mapeamento salvo para este SKU. Você pode manter ou trocar a embalagem abaixo.</div>` : ''}
          <div class="kzpkg-grid">${options}</div>
          ${analysis.fixedEligible ? `
            <label class="kzpkg-check">
              <input id="kzpkg-save-fixed" type="checkbox">
              <span>Salvar a embalagem escolhida como <b>fixa para o SKU ${escapeHtml(analysis.sku)}</b></span>
            </label>
          ` : ''}
          <div class="kzpkg-links">
            <a href="${SHEET_URL}#gid=${PACKAGING_GID}" target="_blank" rel="noopener">Cadastrar/editar embalagens</a>
          </div>
          <div class="kzpkg-actions">
            <button id="kzpkg-cancel" type="button">Cancelar impressão</button>
            <button id="kzpkg-confirm" type="button" class="primary">Confirmar embalagem e imprimir</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#kzpkg-cancel').onclick = () => {
        closeModal();
        reject(new Error('Impressão cancelada: embalagem não confirmada.'));
      };
      modal.querySelector('#kzpkg-confirm').onclick = () => {
        const checked = modal.querySelector('input[name="kzpkg-choice"]:checked');
        if (!checked) {
          const card = modal.querySelector('.kzpkg-card');
          const warn = document.createElement('div');
          warn.className = 'kzpkg-status error';
          warn.textContent = 'Selecione uma embalagem para continuar.';
          card.insertBefore(warn, card.querySelector('.kzpkg-actions'));
          setTimeout(() => warn.remove(), 2200);
          return;
        }
        const selected = packages.find(pkg => norm(pkg.id) === norm(checked.value));
        const saveFixed = Boolean(modal.querySelector('#kzpkg-save-fixed')?.checked);
        closeModal();
        resolve({ selected, saveFixed });
      };
      modal.addEventListener('click', event => {
        if (event.target === modal) {
          closeModal();
          reject(new Error('Impressão cancelada: embalagem não confirmada.'));
        }
      });
      setTimeout(() => modal.querySelector('input[name="kzpkg-choice"]:checked')?.focus(), 20);
    });
  }

  function updateLocalMapping(sku, title, packaging) {
    const cache = getCache();
    if (!cache) return;
    const target = normSku(sku);
    const mappings = [...(cache.skuMappings || [])];
    const index = mappings.findIndex(row => normSku(row?.sku) === target);
    const row = {
      ...(index >= 0 ? mappings[index] : {}),
      sku: target,
      title: norm(title),
      packagingId: packaging.id,
      packagingName: packaging.name,
      lastSeenAt: nowIso(),
    };
    if (index >= 0) mappings[index] = row;
    else mappings.push(row);
    saveCache({ ...cache, skuMappings: mappings });
  }

  function enqueue(payload) {
    const queue = getQueue();
    const identity = norm(payload?.idempotencyKey || payload?.queueKey || '');
    if (identity && queue.some(item => norm(item?.identity) === identity)) return;
    queue.push({
      id: 'Q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      identity,
      payload,
      createdAt: nowIso(),
      tries: 0,
      lastError: '',
    });
    saveQueue(queue);
  }

  async function flushQueue() {
    if (flushPromise) return flushPromise;
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.token) return;

    flushPromise = (async () => {
      let queue = getQueue();
      if (!queue.length) return;

      const remaining = [];
      for (const item of queue) {
        try {
          await apiPost(item.payload);
        } catch (error) {
          remaining.push({
            ...item,
            tries: Number(item.tries || 0) + 1,
            lastError: error?.message || String(error),
            lastTryAt: nowIso(),
          });
        }
      }
      saveQueue(remaining);
    })();

    try { await flushPromise; }
    finally { flushPromise = null; }
  }

  async function saveFixedMapping(context) {
    if (!context?.analysis?.fixedEligible || !context?.packaging) return;
    const payload = {
      action: 'upsertSkuMapping',
      sku: context.analysis.sku,
      title: context.analysis.title || '',
      packagingId: context.packaging.id,
      puid: context.puid || '',
      account: context.account || '',
      queueKey: 'MAP|' + context.analysis.sku,
    };
    updateLocalMapping(context.analysis.sku, context.analysis.title, context.packaging);
    enqueue(payload);
    flushQueue();
  }

  async function preparePrint(input) {
    const cfg = getConfig();
    if (!cfg.enabled) return { disabled: true, version: VERSION };
    if (!cfg.token) {
      showSettingsModal();
      throw new Error('Controle de embalagens ativo, mas o API_TOKEN ainda não foi configurado.');
    }

    const orders = Array.isArray(input?.orders) ? input.orders : [];
    if (!orders.length) throw new Error('Não encontrei pedidos para vincular à embalagem.');

    const cache = await bootstrap(false);
    const packages = activePackaging(cache);
    if (!packages.length) {
      throw new Error('Nenhuma embalagem ativa cadastrada na planilha. Cadastre uma embalagem e atualize os cadastros.');
    }

    const analysis = analyzeOrders(orders);
    const mapping = analysis.fixedEligible ? mappingForSku(cache, analysis.sku) : null;
    const fixedPackage = mapping?.packagingId ? packagingById(cache, mapping.packagingId) : null;

    const puid = norm(input?.puid);
    const account = norm(orders[0]?.shopName);

    if (fixedPackage && analysis.fixedEligible) {
      const context = {
        version: VERSION,
        disabled: false,
        packaging: fixedPackage,
        selectionOrigin: 'FIXED',
        analysis,
        puid,
        account,
        preparedAt: nowIso(),
      };
      return context;
    }

    const result = await choosePackagingModal(packages, analysis, mapping);
    const context = {
      version: VERSION,
      disabled: false,
      packaging: result.selected,
      selectionOrigin: result.saveFixed ? 'MANUAL_FIXED' : 'MANUAL',
      analysis,
      puid,
      account,
      preparedAt: nowIso(),
    };

    if (result.saveFixed) saveFixedMapping(context);
    return context;
  }

  function operationPayload(order, context, checkoutVersion) {
    const items = normalizeItems(order);
    const puid = norm(context?.puid);
    const orderId = norm(order?.idStr);
    return {
      action: 'logOperation',
      eventId: 'OP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      idempotencyKey: [puid, orderId, 'ORIGINAL'].join('|'),
      puid,
      account: norm(order?.shopName || context?.account),
      marketplace: norm(order?.channel),
      orderId,
      orderNo: norm(order?.orderNo),
      orderType: norm(order?.category),
      skus: items,
      packagingId: norm(context?.packaging?.id),
      selectionOrigin: norm(context?.selectionOrigin || 'MANUAL'),
      checkoutVersion: norm(checkoutVersion),
      notes: context?.analysis?.orderCount > 1 ? `Lote de ${context.analysis.orderCount} pedido(s)` : '',
    };
  }

  async function recordSuccessfulPrints(input) {
    const context = input?.context;
    if (!context || context.disabled) return;
    const orders = Array.isArray(input?.successfulOrders) ? input.successfulOrders : [];
    if (!orders.length) return;

    for (const order of orders) {
      const payload = operationPayload(order, context, input?.checkoutVersion);
      if (!payload.orderId || !payload.puid || !payload.packagingId) {
        console.warn('[KZ Packaging] operação incompleta, não enfileirada:', payload);
        continue;
      }
      enqueue(payload);
    }
    flushQueue();
  }

  function updateSidebarButton() {
    const panel = document.getElementById('kzqc-panel');
    if (!panel) return;
    const actions = panel.querySelector('#kzqc-flight-logs')?.parentElement || panel.querySelector('.kzqc-sidebar .kzqc-sidebar-section:last-of-type');
    if (!actions) return;

    let button = panel.querySelector('#kzpkg-settings-button');
    if (!button) {
      button = document.createElement('button');
      button.id = 'kzpkg-settings-button';
      button.type = 'button';
      button.className = 'kzqc-side-action';
      button.tabIndex = -1;
      actions.appendChild(button);
    }

    const cfg = getConfig();
    const queue = getQueue();
    const cache = getCache();
    const count = activePackaging(cache).length;
    button.classList.toggle('active', Boolean(cfg.enabled));
    button.innerHTML = `Embalagens <b>${cfg.enabled ? (queue.length ? queue.length + ' pend.' : count + ' cad.') : 'off'}</b>`;
    button.title = cfg.enabled
      ? 'Controle de embalagem ativo. Clique para configurar.'
      : 'Controle de embalagem desligado. Clique para configurar.';
  }

  function startUiObserver() {
    // Pointerdown no window/capture acontece antes dos handlers normais do
    // UpSeller. Assim o clique nunca chega ao scanner/formulários da página.
    window.addEventListener('pointerdown', event => {
      const button = event.target?.closest?.('#kzpkg-settings-button');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showSettingsModal();
    }, true);

    const run = () => {
      clearTimeout(injectTimer);
      injectTimer = setTimeout(updateSidebarButton, 80);
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  try {
    GM_registerMenuCommand('Kryzer: Embalagens e cobrança', showSettingsModal);
  } catch {}

  setInterval(() => {
    const cfg = getConfig();
    if (cfg.enabled && cfg.token) {
      flushQueue();
      const cache = getCache();
      if (!cache || Date.now() - Number(cache.at || 0) > CACHE_TTL_MS) {
        bootstrap(true).catch(error => console.warn('[KZ Packaging] bootstrap:', error));
      }
    }
  }, 30000);

  globalThis.KryzerPackaging = {
    version: VERSION,
    endpoint: API_URL,
    sheetUrl: SHEET_URL,
    preparePrint,
    recordSuccessfulPrints,
    showSettings: showSettingsModal,
    refresh: () => bootstrap(true),
    flushQueue,
    status: () => ({
      config: { ...getConfig(), token: getConfig().token ? '***' : '' },
      cache: getCache(),
      pending: getQueue().length,
    }),
  };

  if (document.documentElement) startUiObserver();
  else window.addEventListener('DOMContentLoaded', startUiObserver, { once: true });

  console.log('[KZ Packaging] módulo carregado', VERSION);
})();
