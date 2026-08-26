// ==UserScript==
// @name         Kryzer - Criar Kit (teste isolado)
// @namespace    kryzer-criar-kit-standalone
// @version      0.1.0
// @description  Teste isolado do módulo "Criar Kit" antes de integrar ao Kryzer App unificado. Composição de kit + geração de XLSX, com config e sequência K compartilhadas via Supabase.
// @match        https://app.upseller.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      neetghmmqrnttrzzrcqs.supabase.co
// @updateURL    https://neetghmmqrnttrzzrcqs.supabase.co/storage/v1/object/public/scripts/criar-kit-standalone.user.js
// @downloadURL  https://neetghmmqrnttrzzrcqs.supabase.co/storage/v1/object/public/scripts/criar-kit-standalone.user.js
// ==/UserScript==

// Script isolado pra testar o módulo "Criar Kit" antes de integrar como
// módulo do Kryzer App unificado (kryzer-agent.user.js) — mesma lógica que
// vai virar `criar` no bundle principal depois de validado, só que aqui
// roda sozinho, sempre ativo (sem depender de papel/módulo do painel).
(function () {
  'use strict';

  const SUPABASE_BASE = 'https://neetghmmqrnttrzzrcqs.supabase.co/functions/v1';
  const SHARED_SECRET = 'lyeTXzPNPVeubYes1LbptH7kKm19XE93';

  function callBackend(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-Kryzer-Secret': SHARED_SECRET,
        },
        data: JSON.stringify(payload),
        timeout: 60000,
        onload: (res) => {
          let body = null;
          try { body = JSON.parse(res.responseText); } catch {}
          resolve({ status: res.status, body });
        },
        onerror: () => reject(new Error('network_error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  const FULLSCREEN_QUERY = 'kzCriar';
  const FULLSCREEN_MODE = new URLSearchParams(location.search).get(FULLSCREEN_QUERY) === '1';
  const OPEN_URL = `${location.origin}/pt/products/product-list?${FULLSCREEN_QUERY}=1`;
  const CLIENTE = 'POLLIANA';
  const KIT_TEMPLATE_HEADERS = ['Kit SKU*', 'Título*', 'Imagem', 'SKU*', 'SKU Qnt.*'];
  const XLSX_CDN_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  // SUPABASE_BASE e SHARED_SECRET vêm de header.js — todos os módulos
  // deste bundle compartilham o mesmo escopo externo (ver build.js).
  const KIT_GET_CONFIG_URL = `${SUPABASE_BASE}/kit-get-config`;
  const KIT_SAVE_CONFIG_URL = `${SUPABASE_BASE}/kit-save-config`;
  const KIT_NEXT_SEQUENCE_URL = `${SUPABASE_BASE}/kit-next-sequence`;
  const KIT_UPLOAD_TEMPLATE_URL = `${SUPABASE_BASE}/kit-upload-template`;
  const KIT_DELETE_TEMPLATE_URL = `${SUPABASE_BASE}/kit-delete-template`;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const int = (v, f = 0) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : f;

  const state = {
    loading: true,
    activeTab: 'gerar',
    sizes: [],
    spuProducts: [],
    spuSuffixes: [],
    templateUrl: null,
    lastKNumber: 0,
    selectedSizes: new Set(),
    variationSearch: '',
    sizeSearch: '',
    expandedKitId: 0,
    form: {
      kitName: '',
      kitGroups: [{ kitLabel: 'Kit 1', variations: [], spus: [], quantity: 3 }],
      useSystemSequence: true,
      customSequenceFormat: 'K{NN}.P{QQ}.T{TT}.S{SS}',
    },
  };

  function isLauncherAllowed() {
    return location.pathname.startsWith('/pt/products/');
  }

  function toast(message, type = 'success') {
    $('#kzc-toast')?.remove();
    const e = document.createElement('div');
    e.id = 'kzc-toast';
    e.className = type === 'error' ? 'error' : '';
    e.textContent = message;
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 3200);
  }

  function showLoading(show, text = 'Carregando...') {
    const l = $('#kzc-loading');
    if (!l) return;
    l.classList.toggle('show', show);
    $('span', l).textContent = text;
  }

  function confirmBox({ title, html, confirmText = 'Confirmar', danger = false }) {
    return new Promise(resolve => {
      const b = document.createElement('div');
      b.className = 'kz-modal-backdrop';
      b.innerHTML = `<div class="kz-modal kz-modal-small"><div class="kz-modal-head"><h3>${esc(title)}</h3><button class="kz-icon-btn" data-action="cancel">×</button></div><div class="kz-modal-body">${html}</div><div class="kz-modal-foot"><button class="kz-btn secondary" data-action="cancel">Cancelar</button><button class="kz-btn ${danger ? 'danger' : 'primary'}" data-action="confirm">${esc(confirmText)}</button></div></div>`;
      b.addEventListener('click', e => {
        const a = e.target?.dataset?.action;
        if (!a) return;
        b.remove();
        resolve(a === 'confirm');
      });
      document.body.appendChild(b);
    });
  }

  // ---- backend (Supabase, via callBackend — GM_xmlhttpRequest, evita CORS) ----

  async function loadConfig() {
    const result = await callBackend(KIT_GET_CONFIG_URL, { cliente: CLIENTE });
    if (result.status !== 200 || !result.body) throw new Error('Falha ao carregar configuração do Criar.');
    Object.assign(state, {
      sizes: result.body.sizes || [],
      spuProducts: result.body.spuProducts || [],
      spuSuffixes: result.body.spuSuffixes || [],
      templateUrl: result.body.templateUrl || null,
      lastKNumber: result.body.lastKNumber || 0,
    });
  }

  async function saveConfig() {
    const result = await callBackend(KIT_SAVE_CONFIG_URL, {
      cliente: CLIENTE,
      sizes: state.sizes,
      spuProducts: state.spuProducts,
      spuSuffixes: state.spuSuffixes,
    });
    if (result.status !== 200) throw new Error(result.body?.message || 'Falha ao salvar configuração.');
  }

  async function nextSequence() {
    const result = await callBackend(KIT_NEXT_SEQUENCE_URL, { cliente: CLIENTE });
    if (result.status !== 200 || result.body?.k_number == null) throw new Error('Falha ao obter o próximo número K.');
    return result.body.k_number;
  }

  function uploadTemplate(file) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('cliente', CLIENTE);
      formData.append('file', file, file.name);
      GM_xmlhttpRequest({
        method: 'POST',
        url: KIT_UPLOAD_TEMPLATE_URL,
        headers: { 'X-Kryzer-Secret': SHARED_SECRET },
        data: formData,
        onload: res => {
          let body = null;
          try { body = JSON.parse(res.responseText); } catch {}
          if (res.status === 200 && body?.template_url) resolve(body.template_url);
          else reject(new Error(body?.message || `Falha no upload (HTTP ${res.status}).`));
        },
        onerror: () => reject(new Error('Erro de rede no upload do template.')),
      });
    });
  }

  async function deleteTemplate() {
    const result = await callBackend(KIT_DELETE_TEMPLATE_URL, { cliente: CLIENTE });
    if (result.status !== 200) throw new Error('Falha ao remover o template.');
  }

  // ---- lógica de geração (portada 1:1 da versão React) ----

  function syncGroupSpusLength(group) {
    const n = group.variations.length;
    const spus = group.spus || [];
    if (spus.length === n) return group;
    return { ...group, spus: [...spus.slice(0, n), ...new Array(Math.max(0, n - spus.length)).fill('')] };
  }

  function findSuffix(spu, variation) {
    const clean = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanVar = clean(variation);

    let match = state.spuSuffixes.find(s => s.spu === spu && clean(s.keyword) === cleanVar);
    if (match) return match.suffix;

    match = state.spuSuffixes.find(s => s.spu === spu && (cleanVar.includes(clean(s.keyword)) || clean(s.keyword).includes(cleanVar)));
    if (match) return match.suffix;

    match = state.spuSuffixes.find(s => s.spu === '*' && clean(s.keyword) === cleanVar);
    if (match) return match.suffix;

    return String(variation || '').replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'XX';
  }

  function availableVariations() {
    const set = new Set();
    state.spuSuffixes.forEach(s => set.add(s.keyword));
    return [...set].sort();
  }

  function availableSpus() {
    return state.spuProducts.map(p => p.spu).sort();
  }

  function computePreviewRows() {
    const rows = [];
    if (!state.form.kitName.trim()) return rows;

    const selectedSizesList = [...state.sizes]
      .filter(s => s.id && state.selectedSizes.has(s.id))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!selectedSizesList.length) return rows;

    const kNumber = String(state.lastKNumber + 1).padStart(2, '0');
    let sequenceCounter = 1;

    for (const groupRaw of state.form.kitGroups) {
      if (!groupRaw.variations || !groupRaw.variations.length) continue;
      const g = syncGroupSpusLength(groupRaw);
      const numVariations = g.variations.length;
      const isMultiple = numVariations > 1;

      for (const size of selectedSizesList) {
        const pNumber = isMultiple ? String(numVariations).padStart(2, '0') : String(g.quantity).padStart(2, '0');
        const tCode = size.code.length === 2 && /^\d+$/.test(size.code) ? size.code : size.name.charAt(0).toUpperCase();
        const sNumber = String(sequenceCounter).padStart(2, '0');

        const kitSku = state.form.useSystemSequence
          ? `K${kNumber}.P${pNumber}.T${tCode}.S${sNumber}`
          : state.form.customSequenceFormat.replace('{NN}', kNumber).replace('{QQ}', pNumber).replace('{TT}', tCode).replace('{SS}', sNumber);

        const firstSpu = g.spus[0] || '';
        const firstSpuProduct = state.spuProducts.find(p => p.spu === firstSpu);
        const productName = firstSpuProduct?.product_name || 'Produto';

        const titulo = isMultiple
          ? `Kit ${numVariations} ${productName} ${g.variations.join(' - ')} ${size.name}`
          : `Kit ${g.quantity} ${productName} ${g.variations[0]} ${size.name}`;

        if (isMultiple) {
          for (let i = 0; i < numVariations; i++) {
            const spu = g.spus[i] || '';
            if (!spu) continue;
            const suffix = findSuffix(spu, g.variations[i]);
            rows.push({ kitSku, titulo, skuProduto: `${spu}${suffix}${size.code}`, quantidade: 1 });
          }
        } else {
          const spu = g.spus[0] || '';
          if (spu) {
            const suffix = findSuffix(spu, g.variations[0]);
            rows.push({ kitSku, titulo, skuProduto: `${spu}${suffix}${size.code}`, quantidade: g.quantity });
          }
        }
        sequenceCounter++;
      }
    }
    return rows;
  }

  function validationErrors() {
    const errors = [];
    if (!state.form.kitName.trim()) errors.push('Nome base do kit é obrigatório');
    if (!state.selectedSizes.size) errors.push('Selecione pelo menos 1 tamanho');

    for (const groupRaw of state.form.kitGroups) {
      const group = syncGroupSpusLength(groupRaw);
      if (!group.variations.length) {
        errors.push(`${group.kitLabel}: selecione pelo menos 1 variação`);
        continue;
      }
      for (let i = 0; i < group.variations.length; i++) {
        if (!group.spus[i]) errors.push(`${group.kitLabel}: SPU do item ${i + 1} (${group.variations[i]}) é obrigatório`);
      }
      if (group.variations.length === 1 && group.quantity < 1) errors.push(`${group.kitLabel}: quantidade deve ser no mínimo 1`);
    }
    return errors;
  }

  // ---- geração do XLSX (lazy-load do SheetJS só quando este módulo roda) ----

  let xlsxLibPromise = null;
  function ensureXlsxLib() {
    if (window.XLSX) return Promise.resolve();
    if (xlsxLibPromise) return xlsxLibPromise;
    xlsxLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_CDN_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Falha ao carregar a biblioteca de geração de XLSX.'));
      document.head.appendChild(script);
    });
    return xlsxLibPromise;
  }

  async function generateXlsxFile(rows, kNumberReal) {
    await ensureXlsxLib();
    const XLSX = window.XLSX;

    const fixed = rows.map(r => ({ ...r, kitSku: r.kitSku.replace(/^K\d{2}/, `K${kNumberReal}`) }));
    const aoa = fixed.map(r => [r.kitSku, r.titulo, '', r.skuProduto, r.quantidade]);

    let workbook;
    if (state.templateUrl) {
      const response = await fetch(state.templateUrl);
      if (!response.ok) throw new Error('Falha ao baixar o template XLSX.');
      const arrayBuffer = await response.arrayBuffer();
      workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const ws = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      for (let r = 1; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) delete ws[XLSX.utils.encode_cell({ r, c })];
      }
      XLSX.utils.sheet_add_aoa(ws, aoa, { origin: 'A2' });
      const newRange = { s: { r: 0, c: 0 }, e: { r: aoa.length, c: Math.max(range.e.c, 4) } };
      ws['!ref'] = XLSX.utils.encode_range(newRange);
    } else {
      workbook = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([KIT_TEMPLATE_HEADERS, ...aoa]);
      XLSX.utils.book_append_sheet(workbook, ws, 'Import_Composition_Template');
    }

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Kit_${state.form.kitName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function generateXlsx() {
    const errors = validationErrors();
    if (errors.length) {
      await confirmBox({ title: 'Corrija antes de gerar', html: `<ul style="margin:0;padding-left:18px">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`, confirmText: 'Entendi' });
      return;
    }
    const rows = computePreviewRows();
    try {
      showLoading(true, 'Reservando número do kit...');
      const kNumber = await nextSequence();
      const kNumberReal = String(kNumber).padStart(2, '0');
      showLoading(true, 'Gerando arquivo XLSX...');
      await generateXlsxFile(rows, kNumberReal);
      state.lastKNumber = kNumber;
      toast(`XLSX gerado — K${kNumberReal}.`);
      renderGerarTab();
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error');
    } finally {
      showLoading(false);
    }
  }

  // ---- UI shell (mesmo padrão visual do módulo compras) ----

  function injectGlobalStyles() {
    if ($('#kzc-compras-global-style')) return;
    const s = document.createElement('style');
    s.id = 'kzc-compras-global-style';
    s.textContent = `#kzc-criar-launcher{position:fixed;right:18px;bottom:70px;z-index:2147483000;border:0;border-radius:12px;background:#7c3aed;color:#fff;display:flex;align-items:center;gap:9px;padding:9px 13px;box-shadow:0 10px 30px rgba(0,0,0,.24);cursor:pointer;font-family:Arial,sans-serif}#kzc-criar-launcher .kzc-launcher-logo{width:28px;height:28px;border-radius:8px;background:#4c1d95;display:grid;place-items:center;font-weight:900}#kzc-criar-launcher span:last-child{display:flex;flex-direction:column;align-items:flex-start}#kzc-criar-launcher b{font-size:12px;line-height:1.1}#kzc-criar-launcher small{font-size:9px;color:#ddd6fe;margin-top:2px}#kzc-toast{position:fixed;left:50%;top:85px;transform:translateX(-50%);z-index:2147483647;background:#172033;color:#fff;padding:11px 16px;border-radius:9px;box-shadow:0 10px 28px rgba(0,0,0,.25);font:700 12px Arial}#kzc-toast.error{background:#b42318}`;
    document.documentElement.appendChild(s);
  }

  function removeLauncher() {
    $('#kzc-criar-launcher')?.remove();
  }

  function createLauncher() {
    if (FULLSCREEN_MODE || !isLauncherAllowed()) { removeLauncher(); return; }
    if ($('#kzc-criar-launcher')) return;
    const b = document.createElement('button');
    b.id = 'kzc-criar-launcher';
    b.innerHTML = '<span class="kzc-launcher-logo">K</span><span><b>Criar Kit</b><small>Abrir tela completa</small></span>';
    b.addEventListener('click', () => {
      const w = window.open(OPEN_URL, '_blank');
      if (!w) toast('O navegador bloqueou a nova guia.', 'error');
    });
    (document.body || document.documentElement).appendChild(b);
  }

  function syncLauncherVisibility() {
    if (FULLSCREEN_MODE) return;
    if (isLauncherAllowed()) createLauncher();
    else removeLauncher();
  }

  function bootLauncher() {
    injectGlobalStyles();
    syncLauncherVisibility();
    window.addEventListener('kz:routechange', () => setTimeout(syncLauncherVisibility, 0));
    const observer = new MutationObserver(syncLauncherVisibility);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(syncLauncherVisibility, 1500);
  }

  function fullscreenStyles() {
    // Reaproveita as mesmas classes kz-* já usadas pelo módulo compras —
    // são guias separadas (window.open), nunca montadas ao mesmo tempo na
    // mesma página, então não há colisão de estilo entre os dois.
    return `*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#f3f5f8!important;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;color:#1f2937}body>*:not(#kzc-app):not(#kzc-toast):not(.kz-modal-backdrop){display:none!important}#kzc-app{position:fixed;inset:0;z-index:2147483000;background:#f3f5f8;display:flex;flex-direction:column}.kz-top{height:66px;background:#172033;color:#fff;padding:0 22px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(0,0,0,.15)}.kz-brand{display:flex;align-items:center;gap:11px}.kz-logo{width:34px;height:34px;border-radius:10px;background:#7c3aed;display:grid;place-items:center;font-weight:900;font-size:17px}.kz-brand h1{font-size:17px;margin:0;color:#fff!important}.kz-brand p{font-size:10px;color:#d9e2f0!important;margin:3px 0 0}.kz-close-app{width:34px;height:34px;border:1px solid #425069;background:#26334b;color:#fff;border-radius:9px;cursor:pointer}.kz-tabs{height:52px;background:#fff;border-bottom:1px solid #dfe4eb;padding:8px 18px;display:flex;align-items:center;gap:8px}.kz-tab{height:35px;padding:0 16px;border:1px solid #d3dae4;border-radius:8px;background:#fff;color:#4b5563;font-size:12px;font-weight:700;cursor:pointer}.kz-tab.active{background:#7c3aed;color:#fff;border-color:#7c3aed;box-shadow:0 5px 14px rgba(124,58,237,.2)}.kz-main{flex:1;min-height:0;display:flex;overflow:hidden}.kz-side{width:280px;padding:14px;border-right:1px solid #dde3eb;background:#f7f9fc;overflow:auto}.kz-content{flex:1;min-width:0;padding:14px;overflow:auto}.kz-card{background:#fff;border:1px solid #dfe5ed;border-radius:12px;box-shadow:0 3px 12px rgba(15,23,42,.045);margin-bottom:12px}.kz-card-head{padding:12px 14px;border-bottom:1px solid #edf0f4;display:flex;align-items:center;justify-content:space-between;gap:10px}.kz-card-head h3{margin:0;font-size:13px}.kz-card-body{padding:12px 14px}.kz-label{display:block;font-size:10px;color:#667085;font-weight:700;margin:0 0 5px}.kz-input,.kz-select{width:100%;height:36px;border:1px solid #ccd5e0;border-radius:8px;background:#fff;padding:0 10px;font-size:12px;outline:none}.kz-input:focus,.kz-select:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.1)}.kz-field{margin-bottom:10px}.kz-btn{height:35px;border:0;border-radius:8px;padding:0 13px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}.kz-btn.primary{background:#7c3aed;color:#fff}.kz-btn.success{background:#12a150;color:#fff}.kz-btn.danger{background:#d92d20;color:#fff}.kz-btn.secondary{background:#edf1f6;color:#344054}.kz-btn.ghost{background:#fff;border:1px solid #d0d7e2;color:#344054}.kz-btn.small{height:29px;padding:0 9px;font-size:10px}.kz-btn:disabled{opacity:.5;cursor:not-allowed}.kz-button-stack{display:grid;gap:7px}.kz-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}.kz-stat{background:#fff;border:1px solid #dfe5ed;border-radius:11px;padding:12px}.kz-stat span{display:block;font-size:10px;color:#667085}.kz-stat strong{display:block;font-size:20px;margin-top:5px;color:#101828}.kz-table-wrap{overflow:auto}.kz-table{width:100%;border-collapse:collapse;min-width:640px}.kz-table th{position:sticky;top:0;z-index:2;background:#f8fafc;color:#667085;font-size:10px;text-align:left;padding:9px 10px;border-bottom:1px solid #e6eaf0;white-space:nowrap}.kz-table td{padding:8px 10px;border-bottom:1px solid #eef1f5;font-size:11px;vertical-align:middle}.kz-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:800}.kz-badge.green{background:#e9f8ef;color:#087a3f}.kz-badge.yellow{background:#fff4d9;color:#9b6500}.kz-empty{padding:42px 20px;text-align:center;color:#667085;font-size:12px}.kz-muted{color:#667085;font-size:10px}.kz-loading{display:none;position:fixed;inset:0;z-index:2147483645;background:rgba(255,255,255,.78);align-items:center;justify-content:center}.kz-loading.show{display:flex}.kz-spinner{width:34px;height:34px;border:4px solid #e5eaf1;border-top-color:#7c3aed;border-radius:50%;animation:kzcspin .75s linear infinite}.kz-loading-box{text-align:center;font-size:11px;color:#475467}.kz-loading-box span{display:block;margin-top:10px}@keyframes kzcspin{to{transform:rotate(360deg)}}.kz-modal-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(16,24,40,.58);display:flex;align-items:center;justify-content:center;padding:18px}.kz-modal{width:min(980px,96vw);max-height:92vh;background:#fff;border-radius:13px;box-shadow:0 28px 80px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden}.kz-modal-small{width:min(520px,94vw)}.kz-modal-head{height:54px;padding:0 16px;border-bottom:1px solid #e6eaf0;display:flex;align-items:center;justify-content:space-between}.kz-modal-head h3{margin:0;font-size:14px}.kz-modal-body{padding:15px;overflow:auto;font-size:12px}.kz-modal-foot{padding:11px 15px;border-top:1px solid #e6eaf0;display:flex;justify-content:flex-end;gap:8px}.kz-icon-btn{width:30px;height:30px;border:0;border-radius:8px;background:#eef1f5;color:#475467;cursor:pointer}.kzc-kit-group{background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:10px}.kzc-kit-group-head{width:100%;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;background:none;border:0;cursor:pointer;font:inherit;text-align:left}.kzc-kit-group-head:hover{background:#f3f4f6}.kzc-kit-group-body{padding:0 14px 14px}.kzc-var-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}.kzc-var-row.selected{background:#ede9fe}.kzc-size-pill{padding:8px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid #d0d7e2;background:#fff;color:#344054}.kzc-size-pill.active{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-color:transparent}.kzc-remove-row{border:0;background:#fff1f0;color:#cf1322;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:13px;flex:0 0 auto}@media(max-width:960px){.kz-side{width:230px}}`;
  }

  function mountFullscreen() {
    const ready = () => {
      if (!document.body) return setTimeout(ready, 30);
      document.title = 'Criar Kit - UpSeller';
      const st = document.createElement('style');
      st.textContent = fullscreenStyles();
      document.head.appendChild(st);
      const app = document.createElement('div');
      app.id = 'kzc-app';
      app.innerHTML = `<header class="kz-top"><div class="kz-brand"><div class="kz-logo">K</div><div><h1>Criar Kit</h1><p>Composição de kits · SKU sequencial</p></div></div><div><button class="kz-close-app" id="kzc-close-app">×</button></div></header><nav class="kz-tabs"><button class="kz-tab" data-tab="gerar">Gerar</button><button class="kz-tab" data-tab="config">Configuração</button></nav><main class="kz-main"><aside class="kz-side" id="kzc-side"></aside><section class="kz-content" id="kzc-content"></section></main><div class="kz-loading" id="kzc-loading"><div class="kz-loading-box"><div class="kz-spinner"></div><span>Carregando...</span></div></div>`;
      document.body.appendChild(app);
      $('#kzc-close-app').onclick = () => window.close();
      $$('.kz-tab').forEach(b => b.onclick = () => { state.activeTab = b.dataset.tab; renderApp(); });
      initializeApp();
    };
    ready();
  }

  async function initializeApp() {
    try {
      showLoading(true, 'Carregando configuração...');
      await loadConfig();
      renderApp();
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error');
    } finally {
      showLoading(false);
    }
  }

  function setActiveTab() {
    $$('.kz-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.activeTab));
  }

  function renderApp() {
    setActiveTab();
    if (state.activeTab === 'config') renderConfigTab();
    else renderGerarTab();
  }

  // ---- aba Configuração ----

  function renderConfigTab() {
    $('#kzc-side').innerHTML = `<section class="kz-card"><div class="kz-card-head"><h3>Sobre</h3></div><div class="kz-card-body kz-muted">Tamanhos, SPUs e sufixos ficam salvos no Supabase — compartilhados entre todos os computadores que usam este módulo.</div></section>`;
    $('#kzc-content').innerHTML = `
      <section class="kz-card"><div class="kz-card-head"><h3>Template Kit (UpSeller)</h3></div><div class="kz-card-body" id="kzc-template-body"></div></section>
      <section class="kz-card"><div class="kz-card-head"><h3>Tamanhos</h3><button class="kz-btn secondary small" id="kzc-add-size">+ Adicionar</button></div><div class="kz-card-body" id="kzc-sizes-body"></div></section>
      <section class="kz-card"><div class="kz-card-head"><h3>SPU + Nome do Produto</h3><button class="kz-btn secondary small" id="kzc-add-product">+ Adicionar</button></div><div class="kz-card-body" id="kzc-products-body"></div></section>
      <section class="kz-card"><div class="kz-card-head"><h3>Mapeamento de Sufixos (Map Modelos)</h3><button class="kz-btn secondary small" id="kzc-add-suffix">+ Adicionar</button></div><div class="kz-card-body" id="kzc-suffixes-body"></div></section>
      <div style="display:flex;justify-content:flex-end"><button class="kz-btn primary" id="kzc-save-config">Salvar Configuração</button></div>
    `;
    renderTemplateSection();
    renderSizesSection();
    renderProductsSection();
    renderSuffixesSection();
    $('#kzc-add-size').onclick = () => { state.sizes.push({ name: '', code: '', sort_order: state.sizes.length }); renderSizesSection(); };
    $('#kzc-add-product').onclick = () => { state.spuProducts.push({ spu: '', product_name: '' }); renderProductsSection(); };
    $('#kzc-add-suffix').onclick = () => { state.spuSuffixes.push({ spu: '', keyword: '', suffix: '' }); renderSuffixesSection(); };
    $('#kzc-save-config').onclick = async () => {
      try {
        showLoading(true, 'Salvando...');
        await saveConfig();
        toast('Configuração salva.');
      } catch (e) {
        console.error(e);
        toast(e.message || String(e), 'error');
      } finally {
        showLoading(false);
      }
    };
  }

  function renderTemplateSection() {
    const box = $('#kzc-template-body');
    if (!box) return;
    if (state.templateUrl) {
      box.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#e9f8ef;border:1px solid #b7ebc6;border-radius:8px"><span style="font-size:12px;color:#087a3f">Template XLSX configurado</span><button class="kz-btn danger small" id="kzc-remove-template">Remover</button></div>`;
      $('#kzc-remove-template').onclick = async () => {
        const ok = await confirmBox({ title: 'Remover template', html: '<p>Volta a usar os headers padrão do módulo.</p>', confirmText: 'Remover', danger: true });
        if (!ok) return;
        try { showLoading(true, 'Removendo...'); await deleteTemplate(); state.templateUrl = null; renderTemplateSection(); toast('Template removido.'); }
        catch (e) { toast(e.message || String(e), 'error'); }
        finally { showLoading(false); }
      };
    } else {
      box.innerHTML = `<div style="border:2px dashed #d0d7e2;border-radius:8px;padding:18px;text-align:center"><p class="kz-muted" style="margin-bottom:10px">Sem template — usando os headers padrão (Kit SKU*, Título*, Imagem, SKU*, SKU Qnt.*)</p><label class="kz-btn primary small" style="cursor:pointer;display:inline-flex"><input type="file" accept=".xlsx,.xls" id="kzc-template-input" style="display:none">Enviar template do UpSeller</label></div>`;
      $('#kzc-template-input').onchange = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          showLoading(true, 'Enviando template...');
          state.templateUrl = await uploadTemplate(file);
          renderTemplateSection();
          toast('Template salvo.');
        } catch (err) {
          toast(err.message || String(err), 'error');
        } finally {
          showLoading(false);
        }
      };
    }
  }

  function renderSizesSection() {
    const box = $('#kzc-sizes-body');
    if (!box) return;
    if (!state.sizes.length) { box.innerHTML = '<p class="kz-muted">Nenhum tamanho cadastrado. Ex: P, M, G.</p>'; return; }
    box.innerHTML = state.sizes.map((s, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px" data-idx="${i}">
        <input class="kz-input" style="flex:1" placeholder="Nome (ex: Médio)" value="${esc(s.name)}" data-field="name">
        <input class="kz-input" style="width:80px" placeholder="Código" value="${esc(s.code)}" data-field="code">
        <button class="kzc-remove-row" data-remove>×</button>
      </div>`).join('');
    $$('[data-idx]', box).forEach(row => {
      const i = int(row.dataset.idx);
      $$('input', row).forEach(inp => inp.onchange = e => { state.sizes[i][e.target.dataset.field] = e.target.value; });
      $('[data-remove]', row).onclick = () => { state.sizes.splice(i, 1); renderSizesSection(); };
    });
  }

  function renderProductsSection() {
    const box = $('#kzc-products-body');
    if (!box) return;
    if (!state.spuProducts.length) { box.innerHTML = '<p class="kz-muted">Nenhum SPU cadastrado. Ex: SPU 504 → Vestido Ciganinha</p>'; return; }
    box.innerHTML = state.spuProducts.map((p, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px" data-idx="${i}">
        <input class="kz-input" style="width:110px" placeholder="SPU (ex: 504)" value="${esc(p.spu)}" data-field="spu">
        <input class="kz-input" style="flex:1" placeholder="Nome do produto" value="${esc(p.product_name)}" data-field="product_name">
        <button class="kzc-remove-row" data-remove>×</button>
      </div>`).join('');
    $$('[data-idx]', box).forEach(row => {
      const i = int(row.dataset.idx);
      $$('input', row).forEach(inp => inp.onchange = e => { state.spuProducts[i][e.target.dataset.field] = e.target.value; });
      $('[data-remove]', row).onclick = () => { state.spuProducts.splice(i, 1); renderProductsSection(); };
    });
  }

  function renderSuffixesSection() {
    const box = $('#kzc-suffixes-body');
    if (!box) return;
    if (!state.spuSuffixes.length) { box.innerHTML = '<p class="kz-muted">Nenhum sufixo cadastrado.</p>'; return; }
    box.innerHTML = `<div class="kz-muted" style="margin-bottom:8px">Ex.: SPU 504 + "Gata Bailarina" → GB · SPU * + "Primavera" → PR (universal)</div>` + state.spuSuffixes.map((s, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px" data-idx="${i}">
        <input class="kz-input" style="width:110px" placeholder="SPU (* = todos)" value="${esc(s.spu)}" data-field="spu">
        <input class="kz-input" style="flex:1" placeholder="Palavra-chave" value="${esc(s.keyword)}" data-field="keyword">
        <input class="kz-input" style="width:90px;text-transform:uppercase" placeholder="Sufixo" value="${esc(s.suffix)}" data-field="suffix">
        <button class="kzc-remove-row" data-remove>×</button>
      </div>`).join('');
    $$('[data-idx]', box).forEach(row => {
      const i = int(row.dataset.idx);
      $$('input', row).forEach(inp => inp.onchange = e => {
        state.spuSuffixes[i][e.target.dataset.field] = e.target.dataset.field === 'suffix' ? e.target.value.toUpperCase() : e.target.value;
      });
      $('[data-remove]', row).onclick = () => { state.spuSuffixes.splice(i, 1); renderSuffixesSection(); };
    });
  }

  // ---- aba Gerar ----

  function getKitSummary(groupRaw) {
    const g = syncGroupSpusLength(groupRaw);
    const spuList = g.spus.filter(Boolean).join(', ');
    const isComplete = g.variations.length > 0 && g.spus.every(Boolean);
    return { selectedCount: g.variations.length, spuList, isComplete };
  }

  function renderGerarTab() {
    const previewRows = computePreviewRows();
    const totalKits = new Set(previewRows.map(r => r.kitSku)).size;
    const errors = validationErrors();
    const kNumber = String(state.lastKNumber + 1).padStart(2, '0');

    $('#kzc-side').innerHTML = `
      <section class="kz-card"><div class="kz-card-head"><h3>Tamanhos</h3><span class="kz-badge green">${state.selectedSizes.size} selecionados</span></div><div class="kz-card-body">
        <input class="kz-input" id="kzc-size-search" placeholder="Buscar tamanhos..." value="${esc(state.sizeSearch)}" style="margin-bottom:10px">
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="kzc-size-pills"></div>
      </div></section>
      ${errors.length ? `<section class="kz-card"><div class="kz-card-body" style="color:#d92d20"><b>Corrija antes de gerar:</b><ul style="margin:6px 0 0;padding-left:16px">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div></section>` : ''}
      ${previewRows.length ? `<section class="kz-card"><div class="kz-card-body"><div class="kz-stats"><div class="kz-stat"><span>Kits</span><strong>${totalKits}</strong></div><div class="kz-stat"><span>Linhas</span><strong>${previewRows.length}</strong></div></div></div></section>` : ''}
      <button class="kz-btn success" id="kzc-generate" style="width:100%;height:44px" ${errors.length ? 'disabled' : ''}>Gerar XLSX (${totalKits} kits) — próximo K${kNumber}</button>
    `;

    $('#kzc-content').innerHTML = `
      <section class="kz-card"><div class="kz-card-head"><h3>Informações do Kit</h3></div><div class="kz-card-body">
        <label class="kz-label">Nome Base do Kit *</label>
        <input class="kz-input" id="kzc-kit-name" placeholder="Ex: Kit Vestido" value="${esc(state.form.kitName)}">
      </div></section>
      <section class="kz-card"><div class="kz-card-head"><h3>Composição dos Kits</h3></div><div class="kz-card-body" id="kzc-kit-groups"></div>
        <div style="padding:0 14px 14px"><button class="kz-btn primary" id="kzc-add-kit-group" style="width:100%">+ Adicionar Novo Kit</button></div>
      </section>
      <section class="kz-card"><div class="kz-card-head"><h3>Sequência de SKU</h3></div><div class="kz-card-body">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="kzc-use-system-seq" ${state.form.useSystemSequence ? 'checked' : ''}> Usar sequência do sistema</label>
        ${!state.form.useSystemSequence ? `<div class="kz-field" style="margin-top:10px"><label class="kz-label">Formato personalizado</label><input class="kz-input" id="kzc-custom-seq" value="${esc(state.form.customSequenceFormat)}"></div>` : ''}
        <p class="kz-muted" style="margin-top:8px">Último K gerado: <b>K${String(state.lastKNumber).padStart(2, '0')}</b> · próximo: <b>K${kNumber}</b></p>
      </div></section>
      ${previewRows.length ? `<section class="kz-card"><div class="kz-card-head"><h3>Prévia (${previewRows.length} linhas)</h3></div><div class="kz-table-wrap"><table class="kz-table"><thead><tr><th>Kit SKU</th><th>Título</th><th>SKU Produto</th><th>Qnt</th></tr></thead><tbody>${previewRows.slice(0, 50).map(r => `<tr><td style="font-family:monospace">${esc(r.kitSku)}</td><td>${esc(r.titulo)}</td><td style="font-family:monospace">${esc(r.skuProduto)}</td><td>${r.quantidade}</td></tr>`).join('')}</tbody></table></div>${previewRows.length > 50 ? `<div class="kz-muted" style="padding:8px 14px">... e mais ${previewRows.length - 50} linhas</div>` : ''}</section>` : ''}
    `;

    renderSizePills();
    renderKitGroups();

    $('#kzc-kit-name').oninput = e => { state.form.kitName = e.target.value; renderGerarTab(); };
    $('#kzc-size-search').oninput = e => { state.sizeSearch = e.target.value; renderSizePills(); };
    $('#kzc-add-kit-group').onclick = () => {
      state.form.kitGroups.push({ kitLabel: `Kit ${state.form.kitGroups.length + 1}`, variations: [], spus: [], quantity: 3 });
      state.expandedKitId = state.form.kitGroups.length - 1;
      renderGerarTab();
    };
    $('#kzc-use-system-seq').onchange = e => { state.form.useSystemSequence = e.target.checked; renderGerarTab(); };
    $('#kzc-custom-seq')?.addEventListener('input', e => { state.form.customSequenceFormat = e.target.value; renderGerarTab(); });
    $('#kzc-generate').onclick = generateXlsx;
  }

  function renderSizePills() {
    const box = $('#kzc-size-pills');
    if (!box) return;
    const filtered = state.sizeSearch.trim()
      ? state.sizes.filter(s => `${s.name} ${s.code}`.toLowerCase().includes(state.sizeSearch.toLowerCase()))
      : state.sizes;
    if (!filtered.filter(s => s.id).length) { box.innerHTML = '<p class="kz-muted">Cadastre tamanhos na aba Configuração.</p>'; return; }
    box.innerHTML = filtered.filter(s => s.id).map(s => `<button type="button" class="kzc-size-pill ${state.selectedSizes.has(s.id) ? 'active' : ''}" data-size-id="${esc(s.id)}">${esc(s.name)} (${esc(s.code)})</button>`).join('');
    $$('[data-size-id]', box).forEach(btn => btn.onclick = () => {
      const id = btn.dataset.sizeId;
      if (state.selectedSizes.has(id)) state.selectedSizes.delete(id); else state.selectedSizes.add(id);
      renderGerarTab();
    });
  }

  function renderKitGroups() {
    const box = $('#kzc-kit-groups');
    if (!box) return;
    box.innerHTML = state.form.kitGroups.map((group, groupIndex) => {
      const summary = getKitSummary(group);
      const isExpanded = state.expandedKitId === groupIndex;
      return `<div class="kzc-kit-group" data-group="${groupIndex}">
        <button type="button" class="kzc-kit-group-head" data-toggle>
          <span><b>${esc(group.kitLabel)}</b> <span class="kz-muted">· ${summary.selectedCount} ${summary.selectedCount === 1 ? 'item' : 'itens'}${summary.spuList ? ` · SPU: ${esc(summary.spuList)}` : ''}</span> <span class="kz-badge ${summary.isComplete ? 'green' : 'yellow'}">${summary.isComplete ? 'Completo' : 'Incompleto'}</span></span>
          <span>${isExpanded ? '▲' : '▼'}</span>
        </button>
        ${isExpanded ? renderKitGroupBody(group, groupIndex) : ''}
      </div>`;
    }).join('');

    $$('[data-toggle]', box).forEach((btn, i) => btn.onclick = () => { state.expandedKitId = state.expandedKitId === i ? -1 : i; renderGerarTab(); });
    $$('[data-remove-group]', box).forEach(btn => btn.onclick = () => { state.form.kitGroups.splice(int(btn.dataset.removeGroup), 1); renderGerarTab(); });
    $$('[data-var-toggle]', box).forEach(el => el.onclick = () => {
      const groupIndex = int(el.dataset.groupIndex);
      const variation = el.dataset.variation;
      const group = state.form.kitGroups[groupIndex];
      const idx = group.variations.indexOf(variation);
      if (idx > -1) { group.variations.splice(idx, 1); group.spus.splice(idx, 1); }
      else { group.variations.push(variation); group.spus.push(''); }
      renderGerarTab();
    });
    $$('[data-spu-select]', box).forEach(sel => sel.onchange = e => {
      const groupIndex = int(sel.dataset.groupIndex);
      const varIndex = int(sel.dataset.varIndex);
      state.form.kitGroups[groupIndex].spus[varIndex] = e.target.value;
      renderGerarTab();
    });
    $('#kzc-var-search')?.addEventListener('input', e => { state.variationSearch = e.target.value; renderGerarTab(); });
    $$('[data-qty]', box).forEach(inp => inp.onchange = e => {
      state.form.kitGroups[int(inp.dataset.qty)].quantity = Math.max(1, int(e.target.value, 1));
      renderGerarTab();
    });
  }

  function renderKitGroupBody(group, groupIndex) {
    const synced = syncGroupSpusLength(group);
    const variations = availableVariations();
    const spus = availableSpus();
    const filtered = state.variationSearch.trim()
      ? variations.filter(v => v.toLowerCase().includes(state.variationSearch.toLowerCase()))
      : variations;
    const selected = filtered.filter(v => group.variations.includes(v));
    const unselected = filtered.filter(v => !group.variations.includes(v));

    const rows = [...selected, ...unselected].map(variation => {
      const isSelected = group.variations.includes(variation);
      const varIndex = group.variations.indexOf(variation);
      return `<div class="kzc-var-row ${isSelected ? 'selected' : ''}">
        <input type="checkbox" ${isSelected ? 'checked' : ''} data-var-toggle data-group-index="${groupIndex}" data-variation="${esc(variation)}">
        <span style="min-width:120px;font-size:12px">${esc(variation)}</span>
        ${isSelected ? `<span style="color:#9ca3af">→</span><select class="kz-select" style="flex:1" data-spu-select data-group-index="${groupIndex}" data-var-index="${varIndex}"><option value="">Selecione o SPU</option>${spus.map(spu => `<option value="${esc(spu)}" ${synced.spus[varIndex] === spu ? 'selected' : ''}>${esc(spu)} - ${esc(state.spuProducts.find(p => p.spu === spu)?.product_name || '')}</option>`).join('')}</select>` : ''}
      </div>`;
    }).join('');

    return `<div style="padding:0 0 4px">
      ${state.form.kitGroups.length > 1 ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="kz-btn danger small" data-remove-group="${groupIndex}">Remover Kit</button></div>` : ''}
      <input class="kz-input" id="kzc-var-search" placeholder="Buscar variações..." value="${esc(state.variationSearch)}" style="margin-bottom:8px">
      <div style="max-height:260px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;padding:6px;background:#fff">${rows || '<p class="kz-muted" style="padding:8px">Cadastre sufixos na aba Configuração.</p>'}</div>
      ${synced.variations.length === 1 ? `<div class="kz-field" style="margin-top:10px"><label class="kz-label">Quantidade do Kit *</label><input type="number" min="1" class="kz-input" value="${int(group.quantity, 1)}" data-qty="${groupIndex}"></div>` : ''}
    </div>`;
  }

  // ---- boot ----

  if (FULLSCREEN_MODE) mountFullscreen();
  else {
    const start = () => document.body ? bootLauncher() : setTimeout(start, 30);
    start();
  }})();
