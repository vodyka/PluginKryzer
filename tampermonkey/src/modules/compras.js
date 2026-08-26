  // =========================================================================
  // MODULE: compras
  // Ported verbatim from the standalone "UpSeller - Controle de Compras e
  // Etiquetas" script. This is a full interactive tool (3 tabs: Comprar /
  // Pedidos / Etiquetas), not a background loop — it shows a small floating
  // launcher button on purchase-related UpSeller pages that opens a fullscreen
  // overlay app in a new tab. WRITES real data: creates purchase orders
  // (/api/procure/add-procure) and registers partial receipts
  // (/api/procure-recevice/recevice) — kept 100% verbatim/untouched, not
  // rewritten, given the real inventory/financial stakes.
  //
  // NOT YET DONE: per-tab permission granularity (the user wants Expedição
  // limited to Pedidos+Etiquetas, no Comprar tab, while Agência gets all 3).
  // Shipped as a single all-or-nothing "compras" module for now — safer to
  // get the whole thing verified working before making a surgical edit to
  // gate individual tabs in this dense, write-capable code.
  // =========================================================================
function initComprasModule() {
  'use strict';

  const VERSION = '0.3.5.0';
  const FULLSCREEN_QUERY = 'kzCompras';
  const FULLSCREEN_MODE = new URLSearchParams(location.search).get(FULLSCREEN_QUERY) === '1';
  const OPEN_URL = `${location.origin}/pt/purchase/orders/to-purchase?${FULLSCREEN_QUERY}=1`;
  const STORAGE_TAGS = 'kz_compras_tags_v1';
  const STORAGE_PAPER = 'kz_compras_paper_v1';
  const STORAGE_ACTIVE_TAB = 'kz_compras_active_tab_v1';
  const PAGE_SIZE = 50;
  const SIZE_MAP = { '00':'PP', '02':'P', '04':'M', '06':'G', '08':'GG' };

  const state = {
    activeTab: localStorage.getItem(STORAGE_ACTIVE_TAB) || 'buy',
    paper: localStorage.getItem(STORAGE_PAPER) || '50x25',
    tags: readJson(STORAGE_TAGS, {}),
    warehouses: [], suppliers: [], inventory: [], shortages: [],
    buyRows: new Map(), purchaseOrders: [], receiveOrders: [],
    selectedWarehouseId: '', selectedSupplierId: '', selectedSupplierName: '',
    buySearch: '', buySort: 'sku', buyOnlyShortage: false, buyOnlySuggested: false, buyStatusFilters: [],
    currentOrder: null, orderSearchResults: [], editorInventory: [], labelsSearch: '', labelsOnlyShortage: false, labelsSize: 'ALL', labelInventoryWarehouseId: '', labelInventory: [], looseLabelSearch: '', looseLabelResults: [], looseLabelItems: [],
    fullLabelMode: false, fullInventoryMap: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const num = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const int = (v, f = 0) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : f;
  const normSku = v => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const fold = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  function readJson(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; } }
  function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function wildcardMatches(value, pattern) {
    const text = fold(value), raw = fold(pattern).trim();
    if (!raw) return true;
    const expr = raw.split('%').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    try { return new RegExp(expr).test(text); } catch { return text.includes(raw.replaceAll('%','')); }
  }
  function skuCompare(a,b){ return normSku(a).localeCompare(normSku(b),'pt-BR',{numeric:true,sensitivity:'base'}); }
  function formatDate(v){ if(!v)return '-'; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR'); }
  function sizeFromSku(sku){ return SIZE_MAP[String(sku||'').slice(-2)] || 'OUTRO'; }
  function labelSize(sku,alias){ const s=sizeFromSku(sku); return s!=='OUTRO'?s:(alias||s); }

  // skuAliasList não vem em /api/warehouse-sku/list nem no detalhe do pedido de
  // recebimento — só existe no cadastro completo do produto. checkout.js já
  // resolveu esse mesmo problema com um pipeline de 2 chamadas (confirmado por
  // captura de rede real): 1) GET /api/sku/scan-sku pra achar o idStr interno
  // do produto a partir do SKU+armazém, 2) POST /api/sku/detail-single com
  // esse idStr, que aí sim devolve skuAliasList. Replicado aqui igual.
  const skuAliasCache = new Map();

  async function fetchSkuIdStr(sku, warehouseId){
    if(!sku || !warehouseId){ console.warn('[Kryzer Compras][alias]', sku, 'sem warehouseId, pulando scan-sku'); return ''; }
    try{
      const url = '/api/sku/scan-sku?' + new URLSearchParams({ searchType:'1', searchValue: sku, sourceType:'2', warehouseId }).toString();
      const res = await fetch(url, { method:'GET', credentials:'include', headers:{ Accept:'application/json, text/plain, */*', 'x-requested-with':'XMLHttpRequest' } });
      const json = await res.json().catch(() => null);
      console.log('[Kryzer Compras][alias] scan-sku', sku, '→ HTTP', res.status, json);
      return String(json?.data?.idStr || json?.data?.id || '').trim();
    }catch(e){ console.warn('[Kryzer Compras][alias] scan-sku falhou', sku, e); return ''; }
  }

  async function fetchSkuAlias(sku){
    const key = normSku(sku);
    if(!key) return '';
    if(skuAliasCache.has(key)) return skuAliasCache.get(key);
    let alias = '';
    try{
      const warehouseId = String($('#labels-wh')?.value || state.selectedWarehouseId || '');
      const idStr = await fetchSkuIdStr(key, warehouseId);
      const payloads = idStr ? [{ idStr }, { id: idStr }, { sku: key }] : [{ sku: key }];
      for(const payload of payloads){
        const res = await fetch('/api/sku/detail-single', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);
        console.log('[Kryzer Compras][alias] detail-single', payload, '→ HTTP', res.status, json);
        const list = json?.data?.skuAliasList;
        if (Array.isArray(list) && list.length) { alias = String(list[0]).trim(); break; }
      }
    }catch(e){ console.warn('[Kryzer Compras] falha ao buscar alias do SKU', key, e); }
    skuAliasCache.set(key, alias);
    return alias;
  }
  function cleanTitle(title, sku){ const size=sizeFromSku(sku); return String(title||'').replace(new RegExp(`\\s+${size}$`,'i'),'').replace(/\s+(PP|P|M|G|GG|XG|XGG)$/i,'').trim(); }

  async function api(url,{method='GET',body=null,form=false}={}){
    const headers={Accept:'application/json, text/plain, */*'}; let payload=body;
    if(body&&form){headers['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';payload=new URLSearchParams(body).toString();}
    else if(body&&typeof body!=='string'){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
    const response=await fetch(url,{method,headers,body:payload,credentials:'include'});
    const text=await response.text(); let json; try{json=JSON.parse(text);}catch{throw new Error(`Resposta inválida: ${text.slice(0,180)}`);}
    if(!response.ok||json?.code!==0)throw new Error(json?.msg||`Erro HTTP ${response.status}`); return json.data;
  }
  async function pagedPost(url,makeBody,extractList,extractTotal){const all=[];let pageNum=1,total=Infinity;while(all.length<total){const data=await api(url,{method:'POST',body:makeBody(pageNum,PAGE_SIZE)});const list=extractList(data)||[];total=num(extractTotal(data),list.length);all.push(...list);if(!list.length||list.length<PAGE_SIZE||pageNum>200)break;pageNum++;}return all;}
  async function loadWarehouses(){state.warehouses=await api('/api/warehouse/list-enable',{method:'POST',body:{}});}
  async function loadSuppliers(searchValue=''){state.suppliers=await api('/api/suppliers/index',{method:'POST',form:true,body:{searchType:0,searchValue}});}
  async function loadInventory(warehouseId){state.inventory=await loadInventoryForWarehouse(warehouseId);}
  async function loadInventoryForWarehouse(warehouseId){return pagedPost('/api/warehouse-sku/list',(pageNum,pageSize)=>({searchType:'1',warehouseId,sortName:'0',sortValue:'0',pageNum,pageSize}),d=>d?.list||[],d=>d?.total||0);}
  async function loadShortages(warehouseId){const list=await pagedPost('/api/sku-order/out-stock-order',(pageNum,pageSize)=>({warehouseId,searchType:1,searchValue:'',pageNum,pageSize,sortName:'2',sortValue:'0'}),d=>d?.pageInfo?.list||[],d=>d?.pageInfo?.total||0);state.shortages=list;return list;}
  async function loadPurchaseOrders(warehouseId=''){state.purchaseOrders=await pagedPost('/api/procure/list',(pageNum,pageSize)=>{const p={sortName:'0',sortValue:'1',pageNum,pageSize,status:'to_purchase',timeType:'0',warehouseType:0};if(warehouseId)p.warehouseId=warehouseId;return p;},d=>d?.list||[],d=>d?.total||0);}
  async function loadReceiveOrdersByStatus(status,warehouseId=''){return pagedPost('/api/procure-recevice/list',(pageNum,pageSize)=>{const p={timeType:'0',pageSize,pageNum,status};if(warehouseId)p.warehouseId=warehouseId;return p;},d=>d?.list||[],d=>d?.total||0);}
  async function loadReceiveOrders(warehouseId=''){const [a,b]=await Promise.all([loadReceiveOrdersByStatus('to_receive',warehouseId),loadReceiveOrdersByStatus('partial_received',warehouseId)]);const m=new Map();[...a,...b].forEach(o=>m.set(String(o.id),o));state.receiveOrders=[...m.values()].sort((x,y)=>String(y.createTime||'').localeCompare(String(x.createTime||'')));}
  async function getPurchaseOrder(id){return api('/api/procure/get-procure-detail',{method:'POST',body:{id:String(id)}});}
  async function getReceiveOrder(id){return api('/api/procure-recevice/detail',{method:'POST',body:{id:String(id)}});}
  async function savePurchaseOrder(payload){return api('/api/procure/add-procure',{method:'POST',body:payload});}
  async function receivePartial(receiveId,detailRows,note=''){return api('/api/procure-recevice/recevice',{method:'POST',body:{id:Number(receiveId),noteList:[{content:note,updateTime:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}],detailUpdateDtoList:detailRows}});}
  async function searchSku(searchValue){const data=await api('/api/sku/search-sku',{method:'POST',body:{pageNum:1,pageSize:50,searchType:'1',searchValue,saleStatus:0,searchGroup:0}});return data?.list||[];}

  function toast(message,type='success'){ $('#kz-toast')?.remove(); const e=document.createElement('div');e.id='kz-toast';e.className=type==='error'?'error':'';e.textContent=message;document.body.appendChild(e);setTimeout(()=>e.remove(),3200); }
  function playTickSound(){try{const AudioContext=window.AudioContext||window.webkitAudioContext;const ctx=new AudioContext();const gain=ctx.createGain();gain.gain.setValueAtTime(0.5,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.16);gain.connect(ctx.destination);const osc=ctx.createOscillator();osc.type='sine';osc.frequency.value=880;osc.connect(gain);osc.start();osc.stop(ctx.currentTime+0.15);setTimeout(()=>ctx.close().catch(()=>{}),300);}catch{}}
  function showLoading(show,text='Carregando...'){const l=$('#kz-loading');if(!l)return;l.classList.toggle('show',show);$('span',l).textContent=text;}
  function confirmBox({title,html,confirmText='Confirmar',danger=false}){return new Promise(resolve=>{const b=document.createElement('div');b.className='kz-modal-backdrop';b.innerHTML=`<div class="kz-modal kz-modal-small"><div class="kz-modal-head"><h3>${esc(title)}</h3><button class="kz-icon-btn" data-action="cancel">×</button></div><div class="kz-modal-body">${html}</div><div class="kz-modal-foot"><button class="kz-btn secondary" data-action="cancel">Cancelar</button><button class="kz-btn ${danger?'danger':'primary'}" data-action="confirm">${esc(confirmText)}</button></div></div>`;b.addEventListener('click',e=>{const a=e.target?.dataset?.action;if(!a)return;b.remove();resolve(a==='confirm');});document.body.appendChild(b);});}


  function alertBox(title, message) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'kz-modal-backdrop';
      backdrop.innerHTML = `<div class="kz-modal kz-modal-small">
        <div class="kz-modal-head"><h3>${esc(title)}</h3><button class="kz-icon-btn" data-ok>×</button></div>
        <div class="kz-modal-body"><div style="display:flex;gap:11px;align-items:flex-start">
          <div style="width:34px;height:34px;border-radius:999px;background:#fff4d9;color:#9b6500;display:grid;place-items:center;font-weight:900;flex:none">!</div>
          <div style="font-size:12px;line-height:1.55;color:#344054">${esc(message)}</div>
        </div></div>
        <div class="kz-modal-foot"><button class="kz-btn primary" data-ok>Entendi</button></div>
      </div>`;
      backdrop.addEventListener('click', event => {
        if (event.target?.dataset?.ok === undefined) return;
        backdrop.remove();
        resolve();
      });
      document.body.appendChild(backdrop);
    });
  }

  function injectGlobalStyles(){if($('#kz-compras-global-style'))return;const s=document.createElement('style');s.id='kz-compras-global-style';s.textContent=`#kz-compras-launcher{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:0;border-radius:12px;background:#172033;color:#fff;display:flex;align-items:center;gap:9px;padding:9px 13px;box-shadow:0 10px 30px rgba(0,0,0,.24);cursor:pointer;font-family:Arial,sans-serif}#kz-compras-launcher .kz-launcher-logo{width:28px;height:28px;border-radius:8px;background:#1267ff;display:grid;place-items:center;font-weight:900}#kz-compras-launcher span:last-child{display:flex;flex-direction:column;align-items:flex-start}#kz-compras-launcher b{font-size:12px;line-height:1.1}#kz-compras-launcher small{font-size:9px;color:#c7ced9;margin-top:2px}#kz-toast{position:fixed;left:50%;top:85px;transform:translateX(-50%);z-index:2147483647;background:#172033;color:#fff;padding:11px 16px;border-radius:9px;box-shadow:0 10px 28px rgba(0,0,0,.25);font:700 12px Arial}#kz-toast.error{background:#b42318}`;document.documentElement.appendChild(s);}
  function removeLauncher(){
    document.querySelector('#kz-compras-launcher')?.remove();
  }

  function isLauncherAllowed(){
    const allowedPaths = [
      '/pt/purchase/orders/to-purchase',
      '/pt/purchase/orders/all',
      '/pt/purchase/orders/in-transit',
      '/pt/purchase/orders/partial-received',
      '/pt/purchase/orders/completed',
      '/pt/purchase/orders/canceled'
    ];

    return allowedPaths.includes(location.pathname);
  }


  function createLauncher(){
    if(FULLSCREEN_MODE||!isLauncherAllowed()){
      removeLauncher();
      return;
    }
    if($('#kz-compras-launcher'))return;
    const b=document.createElement('button');
    b.id='kz-compras-launcher';
    b.innerHTML='<span class="kz-launcher-logo">K</span><span><b>Controle de Compras</b><small>Abrir tela completa</small></span>';
    b.addEventListener('click',()=>{
      const w=window.open(OPEN_URL,'_blank');
      if(!w)toast('O navegador bloqueou a nova guia.','error');
    });
    (document.body||document.documentElement).appendChild(b);
  }

  function syncLauncherVisibility(){
    if(FULLSCREEN_MODE)return;
    if(isLauncherAllowed())createLauncher();
    else removeLauncher();
  }

  function bootLauncher(){
    injectGlobalStyles();
    syncLauncherVisibility();

    const notifyRouteChange=()=>window.dispatchEvent(new Event('kz:routechange'));
    for(const method of ['pushState','replaceState']){
      const original=history[method];
      if(original.__kzWrapped)continue;
      const wrapped=function(...args){
        const result=original.apply(this,args);
        notifyRouteChange();
        return result;
      };
      wrapped.__kzWrapped=true;
      history[method]=wrapped;
    }

    window.addEventListener('popstate',notifyRouteChange);
    window.addEventListener('hashchange',notifyRouteChange);
    window.addEventListener('kz:routechange',()=>setTimeout(syncLauncherVisibility,0));

    const observer=new MutationObserver(syncLauncherVisibility);
    observer.observe(document.documentElement,{childList:true,subtree:true});
    setInterval(syncLauncherVisibility,1000);
  }

  function fullscreenStyles(){return `*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#f3f5f8!important;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;color:#1f2937}body>*:not(#kz-app):not(#kz-toast):not(.kz-modal-backdrop){display:none!important}#kz-app{position:fixed;inset:0;z-index:2147483000;background:#f3f5f8;display:flex;flex-direction:column}.kz-top{height:66px;background:#172033;color:#fff;padding:0 22px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(0,0,0,.15)}.kz-brand{display:flex;align-items:center;gap:11px}.kz-logo{width:34px;height:34px;border-radius:10px;background:#1267ff;display:grid;place-items:center;font-weight:900;font-size:17px}.kz-brand h1{font-size:17px;margin:0;color:#fff!important}.kz-brand p{font-size:10px;color:#d9e2f0!important;margin:3px 0 0}.kz-top-actions{display:flex;align-items:center;gap:10px}.kz-status{font-size:11px;color:#b8c5d7}.kz-close-app{width:34px;height:34px;border:1px solid #425069;background:#26334b;color:#fff;border-radius:9px;cursor:pointer}.kz-tabs{height:52px;background:#fff;border-bottom:1px solid #dfe4eb;padding:8px 18px;display:flex;align-items:center;gap:8px}.kz-tab{height:35px;padding:0 16px;border:1px solid #d3dae4;border-radius:8px;background:#fff;color:#4b5563;font-size:12px;font-weight:700;cursor:pointer}.kz-tab.active{background:#1267ff;color:#fff;border-color:#1267ff;box-shadow:0 5px 14px rgba(18,103,255,.2)}.kz-main{flex:1;min-height:0;display:flex;overflow:hidden}.kz-side{width:284px;flex:0 0 284px;padding:14px;border-right:1px solid #dde3eb;background:#f7f9fc;overflow-y:auto;overflow-x:hidden}.kz-content{flex:1;min-width:0;padding:14px;overflow:auto}.kz-card{background:#fff;border:1px solid #dfe5ed;border-radius:12px;box-shadow:0 3px 12px rgba(15,23,42,.045);margin-bottom:12px}.kz-card-head{padding:12px 14px;border-bottom:1px solid #edf0f4;display:flex;align-items:center;justify-content:space-between;gap:10px}.kz-card-head h3{margin:0;font-size:13px}.kz-card-body{padding:12px 14px}.kz-label{display:block;font-size:10px;color:#667085;font-weight:700;margin:0 0 5px}.kz-input,.kz-select{width:100%;height:36px;border:1px solid #ccd5e0;border-radius:8px;background:#fff;padding:0 10px;font-size:12px;outline:none}.kz-input:focus,.kz-select:focus{border-color:#1267ff;box-shadow:0 0 0 3px rgba(18,103,255,.1)}.kz-field{margin-bottom:10px}.kz-check{display:flex;align-items:center;gap:7px;font-size:11px;color:#475467;margin:8px 0}.kz-check input{accent-color:#1267ff}.kz-btn{height:35px;border:0;border-radius:8px;padding:0 13px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}.kz-btn.primary{background:#1267ff;color:#fff}.kz-btn.success{background:#12a150;color:#fff}.kz-btn.danger{background:#d92d20;color:#fff}.kz-btn.secondary{background:#edf1f6;color:#344054}.kz-btn.ghost{background:#fff;border:1px solid #d0d7e2;color:#344054}.kz-btn.small{height:29px;padding:0 9px;font-size:10px}.kz-button-stack{display:grid;gap:7px}.kz-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}.kz-stat{background:#fff;border:1px solid #dfe5ed;border-radius:11px;padding:12px}.kz-stat span{display:block;font-size:10px;color:#667085}.kz-stat strong{display:block;font-size:20px;margin-top:5px;color:#101828}.kz-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px}.kz-toolbar-left,.kz-toolbar-right{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.kz-table-wrap{overflow:auto}.kz-buy-table-wrap{overflow:visible}.kz-buy-table-wrap .kz-table{position:relative}.kz-buy-table-wrap .kz-table thead{position:sticky;top:0;z-index:12}.kz-buy-table-wrap .kz-table th{box-shadow:0 1px 0 #dfe5ed,0 5px 10px rgba(15,23,42,.05)}.kz-table{width:100%;border-collapse:collapse;min-width:880px}.kz-table th{position:sticky;top:0;z-index:2;background:#f8fafc;color:#667085;font-size:10px;text-align:left;padding:9px 10px;border-bottom:1px solid #e6eaf0;white-space:nowrap}.kz-table td{padding:8px 10px;border-bottom:1px solid #eef1f5;font-size:11px;vertical-align:middle}.kz-table tr:hover td{background:#fbfcfe}.kz-stock-green td{background:#f1faf4}.kz-stock-yellow td{background:#fffbea}.kz-stock-orange td{background:#fff4e8}.kz-stock-red td{background:#fff0f0}.kz-stock-green:hover td{background:#eaf7ef!important}.kz-stock-yellow:hover td{background:#fff7d8!important}.kz-stock-orange:hover td{background:#ffecd9!important}.kz-stock-red:hover td{background:#ffe4e4!important}.kz-editor-zero td{background:#fff0f0!important}.kz-editor-zero:hover td{background:#ffe4e4!important}.kz-table th.center,.kz-table td.center{text-align:center}.kz-product{display:flex;align-items:center;gap:9px;min-width:255px}.kz-product img{width:42px;height:42px;object-fit:contain;border:1px solid #e1e6ed;border-radius:7px;background:#fff}.kz-product-title{min-width:0}.kz-product-title b{display:block;font-size:11px;color:#1d2939}.kz-product-title span{display:block;font-size:10px;color:#667085;margin-top:3px;white-space:normal;line-height:1.3}.kz-qty{width:66px;height:31px;border:1px solid #cfd7e2;border-radius:7px;text-align:center;font-size:11px}.kz-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:800}.kz-badge.blue{background:#e8f1ff;color:#175cd3}.kz-badge.green{background:#e9f8ef;color:#087a3f}.kz-badge.yellow{background:#fff4d9;color:#9b6500}.kz-badge.red{background:#feeceb;color:#b42318}.kz-badge-clickable{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}.kz-badge-clickable:hover{filter:brightness(0.92)}@keyframes kzRowFlash{0%,100%{background:#fff9db}50%{background:#ffe58f}}.kz-row-flash{animation:kzRowFlash 1s ease-in-out 5}.kz-history-item{display:flex;gap:8px;font-size:11px;padding:5px 0;border-bottom:1px solid #f0f0f0}.kz-history-item:last-child{border-bottom:none}.kz-history-time{color:#8c8c8c;font-variant-numeric:tabular-nums;flex:0 0 auto}.kz-filter-badge{border:1px solid transparent;cursor:pointer;user-select:none;transition:.15s ease}.kz-filter-badge.active{outline:2px solid #1267ff;box-shadow:0 0 0 3px rgba(18,103,255,.12)}.kz-filter-badge.clear{background:#f2f4f7;color:#344054}.kz-badge.orange{background:#fff0df;color:#b54708}.kz-badge.gray{background:#eef1f5;color:#344054}.kz-tag-input{width:118px;height:29px;border:1px solid #d2dae5;border-radius:7px;padding:0 8px;font-size:10px}.kz-tag{display:inline-flex;padding:3px 6px;border-radius:999px;background:#eee8ff;color:#6941c6;font-size:9px;font-weight:700;margin-top:4px}.kz-empty{padding:42px 20px;text-align:center;color:#667085;font-size:12px}.kz-muted{color:#667085;font-size:10px}.kz-order-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}.kz-order-card{background:#fff;border:1px solid #dfe5ed;border-radius:12px;overflow:hidden;box-shadow:0 3px 12px rgba(15,23,42,.045)}.kz-order-card-top{padding:13px;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #edf0f4}.kz-order-no{font-size:13px;font-weight:800;color:#101828}.kz-order-meta{font-size:10px;color:#667085;margin-top:3px}.kz-order-body{padding:12px}.kz-order-stats{display:flex;gap:22px}.kz-order-stats strong{font-size:18px}.kz-order-stats span{display:block;font-size:9px;color:#667085}.kz-order-actions{padding:0 12px 12px;display:flex;gap:7px}.kz-loading{display:none;position:fixed;inset:0;z-index:2147483645;background:rgba(255,255,255,.78);align-items:center;justify-content:center}.kz-loading.show{display:flex}.kz-spinner{width:34px;height:34px;border:4px solid #e5eaf1;border-top-color:#1267ff;border-radius:50%;animation:kzspin .75s linear infinite}.kz-loading-box{text-align:center;font-size:11px;color:#475467}.kz-loading-box span{display:block;margin-top:10px}@keyframes kzspin{to{transform:rotate(360deg)}}.kz-modal-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(16,24,40,.58);display:flex;align-items:center;justify-content:center;padding:18px}.kz-modal{width:min(980px,96vw);max-height:92vh;background:#fff;border-radius:13px;box-shadow:0 28px 80px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden}.kz-modal-small{width:min(520px,94vw)}.kz-modal-head{height:54px;padding:0 16px;border-bottom:1px solid #e6eaf0;display:flex;align-items:center;justify-content:space-between}.kz-modal-head h3{margin:0;font-size:14px}.kz-modal-body{padding:15px;overflow:auto;font-size:12px}.kz-modal-foot{padding:11px 15px;border-top:1px solid #e6eaf0;display:flex;justify-content:flex-end;gap:8px}.kz-icon-btn{width:30px;height:30px;border:0;border-radius:8px;background:#eef1f5;color:#475467;cursor:pointer}.kz-search-results{position:absolute;left:0;right:0;top:40px;background:#fff;border:1px solid #d6dee8;border-radius:9px;box-shadow:0 14px 35px rgba(15,23,42,.18);max-height:300px;overflow:auto;z-index:30}.kz-search-item{display:flex;align-items:center;gap:9px;padding:9px 10px;border-bottom:1px solid #edf0f4;cursor:pointer}.kz-search-item:hover{background:#f7f9fc}.kz-search-item img{width:38px;height:38px;object-fit:contain;border:1px solid #e2e7ee;border-radius:7px}.kz-search-item b{font-size:11px}.kz-search-item span{font-size:10px;color:#667085;white-space:normal}.kz-receive-row{display:grid;grid-template-columns:42px minmax(180px,1fr) 80px 80px 90px 105px;gap:9px;align-items:center;padding:9px 0;border-bottom:1px solid #edf0f4}.kz-receive-row img{width:38px;height:38px;object-fit:contain}.kz-progress{height:7px;border-radius:999px;background:#edf1f6;overflow:hidden}.kz-progress span{display:block;height:100%;background:#1267ff}.kz-label-actions{display:flex;gap:6px;align-items:center}.kz-size-filter{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.kz-size-btn{height:31px;border:1px solid #d0d7e2;border-radius:8px;background:#fff;color:#475467;font-size:10px;font-weight:800;cursor:pointer}.kz-size-btn.active{background:#1267ff;border-color:#1267ff;color:#fff;box-shadow:0 4px 12px rgba(18,103,255,.18)}.kz-loose-list{display:grid;gap:6px;margin-top:8px;min-width:0}.kz-loose-row{display:grid;grid-template-columns:minmax(0,1fr) 46px 22px;gap:5px;align-items:center;border:1px solid #e3e8ef;border-radius:8px;padding:6px;background:#fff;min-width:0}.kz-loose-row>div{min-width:0}.kz-loose-row b{display:block;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kz-loose-row span{display:block;font-size:9px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kz-loose-row input{width:100%;height:27px;border:1px solid #cfd7e2;border-radius:7px;text-align:center;font-size:10px;padding:0 2px}.kz-loose-row button{width:22px;height:22px;border:0;border-radius:7px;background:#feeceb;color:#b42318;font-weight:900;cursor:pointer;font-size:11px;padding:0}.kz-mini-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.kz-mini-actions-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}@media(max-width:960px){.kz-side{width:230px;flex-basis:230px}.kz-stats{grid-template-columns:repeat(2,1fr)}}

/* v0.3.5.0 — Compras com linguagem visual do Checkout */
#kz-app{background:#f5f5f5!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;color:#262626!important}
.kz-top{height:68px!important;background:#fff!important;color:#262626!important;padding:0 24px!important;border-bottom:1px solid #e8e8e8!important;box-shadow:0 1px 3px rgba(15,23,42,.04)!important;position:relative;z-index:15}
.kz-logo{width:36px!important;height:36px!important;border-radius:9px!important;background:#1677ff!important;color:#fff!important;box-shadow:0 5px 14px rgba(22,119,255,.22)!important}
.kz-brand h1{color:#262626!important;font-size:16px!important;font-weight:700!important;letter-spacing:-.01em!important}.kz-brand p{color:#8c8c8c!important;font-size:10px!important}
.kz-status{display:inline-flex!important;align-items:center!important;gap:7px!important;min-height:30px!important;padding:0 10px!important;border:1px solid #b7eb8f!important;border-radius:999px!important;background:#f6ffed!important;color:#389e0d!important;font-size:10px!important;font-weight:700!important}.kz-status:before{content:"";width:7px;height:7px;border-radius:50%;background:#52c41a;box-shadow:0 0 0 3px rgba(82,196,26,.13)}
.kz-close-app{width:36px!important;height:36px!important;border:0!important;background:#f5f5f5!important;color:#595959!important;border-radius:50%!important;font-size:20px!important}.kz-close-app:hover{background:#eee!important;color:#262626!important}
.kz-tabs{height:auto!important;min-height:74px!important;background:#f5f5f5!important;border:0!important;padding:14px 20px 10px!important;display:grid!important;grid-template-columns:repeat(3,minmax(180px,240px))!important;gap:10px!important;align-items:stretch!important;overflow-x:auto!important}
.kz-tab{height:50px!important;padding:8px 14px!important;border:1px solid #e8e8e8!important;border-radius:8px!important;background:#fff!important;color:#595959!important;box-shadow:0 1px 2px rgba(0,0,0,.02)!important;text-align:left!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;gap:1px!important;font-size:12px!important;font-weight:600!important}.kz-tab span{display:block;font-size:12px;font-weight:700;line-height:1.2}.kz-tab small{display:block;font-size:9px;font-weight:500;color:#8c8c8c;line-height:1.2}.kz-tab:hover{border-color:#91caff!important;color:#1677ff!important}.kz-tab.active{background:#1677ff!important;border-color:#1677ff!important;color:#fff!important;box-shadow:0 4px 12px rgba(22,119,255,.18)!important}.kz-tab.active small{color:rgba(255,255,255,.8)!important}
.kz-main{flex:1!important;min-height:0!important;display:grid!important;grid-template-columns:260px minmax(0,1fr)!important;gap:16px!important;padding:0 20px 20px!important;background:#f5f5f5!important;overflow:auto!important;align-items:start!important}
#kz-app[data-kz-tab="buy"] .kz-main{grid-template-columns:260px minmax(0,1fr) 300px!important}.kz-side{width:auto!important;min-width:0!important;flex:initial!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important}.kz-content{min-width:0!important;padding:0!important;overflow:visible!important}
.kz-card,.kz-order-card{background:#fff!important;border:1px solid #e8e8e8!important;border-radius:8px!important;box-shadow:0 1px 2px rgba(0,0,0,.02)!important;margin-bottom:12px!important}.kz-card-head{padding:13px 14px!important;border-bottom:1px solid #f0f0f0!important}.kz-card-head h3{font-size:13px!important;font-weight:600!important;color:#262626!important}.kz-card-body{padding:14px!important}.kz-label{font-size:11px!important;color:#595959!important;font-weight:500!important;margin-bottom:6px!important}.kz-input,.kz-select{height:38px!important;border:1px solid #d9d9d9!important;border-radius:4px!important;padding:0 10px!important;font-size:12px!important;color:#262626!important;background:#fff!important}.kz-input:focus,.kz-select:focus{border-color:#40a9ff!important;box-shadow:0 0 0 2px rgba(24,144,255,.15)!important}
.kz-btn{min-height:36px!important;height:36px!important;border-radius:4px!important;padding:0 12px!important;font-size:11px!important;font-weight:600!important;box-shadow:none!important}.kz-btn.primary,.kz-btn.success{background:#1677ff!important;color:#fff!important}.kz-btn.primary:hover,.kz-btn.success:hover{background:#0958d9!important}.kz-btn.secondary,.kz-btn.ghost{background:#fff!important;border:1px solid #d9d9d9!important;color:#595959!important}.kz-btn.small{height:30px!important;min-height:30px!important}
.kz-stats{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:8px!important;margin-bottom:12px!important}.kz-stat{background:#fff!important;border:1px solid #e8e8e8!important;border-radius:8px!important;padding:12px 13px!important;box-shadow:0 1px 2px rgba(0,0,0,.02)!important}.kz-stat span{font-size:9px!important;color:#8c8c8c!important;font-weight:500!important}.kz-stat strong{font-size:19px!important;color:#262626!important;margin-top:4px!important;font-weight:650!important}
.kz-toolbar{padding:12px 14px!important;border-bottom:1px solid #f0f0f0!important}.kz-toolbar-left strong{font-size:13px!important;color:#262626!important}.kz-muted{color:#8c8c8c!important}.kz-filter-badge{outline:0!important;box-shadow:none!important;text-decoration:none!important}.kz-filter-badge.active{border-color:#1677ff!important;background:#e6f4ff!important;color:#1677ff!important}.kz-badge.blue{background:#e6f4ff!important;color:#1677ff!important}.kz-badge.green{background:#f6ffed!important;color:#389e0d!important}.kz-badge.yellow{background:#fffbe6!important;color:#d48806!important}.kz-badge.orange{background:#fff7e6!important;color:#d46b08!important}.kz-badge.red{background:#fff1f0!important;color:#cf1322!important}
.kz-buy-table-wrap{overflow:auto!important;max-height:calc(100vh - 250px)!important}.kz-table{min-width:900px!important}.kz-table th{top:0!important;background:#fafafa!important;color:#8c8c8c!important;font-size:9px!important;font-weight:600!important;padding:10px 9px!important;border-bottom:1px solid #e8e8e8!important;box-shadow:none!important}.kz-table td{padding:9px!important;border-bottom:1px solid #f0f0f0!important;font-size:10px!important}.kz-product{min-width:230px!important}.kz-product img{width:44px!important;height:44px!important;border-radius:5px!important;border-color:#f0f0f0!important}.kz-product-title b{font-size:11px!important;color:#262626!important}.kz-product-title span{font-size:9px!important;color:#8c8c8c!important}.kz-qty,.kz-tag-input{border-radius:4px!important;border-color:#d9d9d9!important}.kz-stock-green td{background:#f6ffed!important}.kz-stock-yellow td{background:#fffbe6!important}.kz-stock-orange td{background:#fff7e6!important}.kz-stock-red td{background:#fff1f0!important}
.kz-order-grid{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))!important;gap:12px!important}.kz-order-card-top{padding:14px!important;border-bottom:1px solid #f0f0f0!important}.kz-order-no{color:#262626!important}.kz-order-meta{color:#8c8c8c!important}.kz-order-body{padding:14px!important}.kz-order-actions{padding:0 14px 14px!important}
.kz-receive-row{grid-template-columns:46px minmax(190px,1fr) 80px 80px 100px 110px!important;padding:10px 0!important;border-bottom:1px solid #f0f0f0!important}.kz-receive-row img{width:42px!important;height:42px!important;border:1px solid #f0f0f0!important;border-radius:5px!important}.kz-progress{height:5px!important;background:#f0f0f0!important}.kz-progress span{background:#1677ff!important}
.kz-buy-summary{display:none;min-width:0;background:#fff;border:1px solid #e8e8e8;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.02);position:sticky;top:0;max-height:calc(100vh - 95px);overflow:hidden}#kz-app[data-kz-tab="buy"] .kz-buy-summary{display:flex;flex-direction:column}.kz-buy-summary-head{padding:14px;border-bottom:1px solid #f0f0f0}.kz-buy-summary-eyebrow{font-size:9px;color:#8c8c8c;font-weight:600;text-transform:uppercase;letter-spacing:.05em}.kz-buy-summary-title{font-size:14px;font-weight:650;color:#262626;margin-top:3px}.kz-buy-summary-context{font-size:9px;color:#8c8c8c;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kz-buy-summary-metrics{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #f0f0f0}.kz-buy-summary-metric{padding:12px 10px}.kz-buy-summary-metric+.kz-buy-summary-metric{border-left:1px solid #f0f0f0}.kz-buy-summary-metric span{display:block;font-size:8px;color:#8c8c8c}.kz-buy-summary-metric strong{display:block;font-size:17px;color:#262626;margin-top:3px}.kz-buy-summary-list{padding:5px 14px;overflow:auto;flex:1;min-height:120px}.kz-buy-summary-empty{padding:28px 6px;text-align:center;color:#8c8c8c;font-size:10px;line-height:1.45}.kz-buy-summary-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f5f5f5}.kz-buy-summary-row img,.kz-buy-summary-img{width:36px;height:36px;object-fit:contain;border:1px solid #f0f0f0;border-radius:4px;background:#fff}.kz-buy-summary-copy{min-width:0}.kz-buy-summary-copy b{display:block;font-size:10px;color:#262626;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kz-buy-summary-copy small{display:block;font-size:8px;color:#8c8c8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.kz-buy-summary-qty{font-size:14px;font-weight:650;color:#1677ff}.kz-buy-summary-actions{padding:12px 14px;border-top:1px solid #f0f0f0;display:grid;gap:7px;background:#fff}.kz-buy-summary-actions button{height:36px;border-radius:4px;font-size:10px;font-weight:650;cursor:pointer}.kz-buy-summary-create{border:0;background:#1677ff;color:#fff}.kz-buy-summary-create:hover{background:#0958d9}.kz-buy-summary-clear{border:1px solid #d9d9d9;background:#fff;color:#595959}.kz-buy-summary-actions button:disabled{opacity:.45;cursor:not-allowed}
#kz-app[data-kz-tab="buy"] #buy-create{display:none!important}
@media(max-width:1320px){#kz-app[data-kz-tab="buy"] .kz-main{grid-template-columns:230px minmax(0,1fr) 270px!important}.kz-main{grid-template-columns:230px minmax(0,1fr)!important;padding-left:14px!important;padding-right:14px!important;gap:12px!important}.kz-stats{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media(max-width:1080px){#kz-app[data-kz-tab="buy"] .kz-main,.kz-main{grid-template-columns:220px minmax(0,1fr)!important}.kz-buy-summary{grid-column:1/-1;position:relative;max-height:none}.kz-buy-summary-list{max-height:280px}}
@media(max-width:760px){#kz-app[data-kz-tab="buy"] .kz-main,.kz-main{grid-template-columns:1fr!important;padding:0 10px 14px!important}.kz-tabs{grid-template-columns:repeat(3,180px)!important;padding-left:10px!important;padding-right:10px!important}.kz-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}.kz-top{padding:0 12px!important}.kz-status{display:none!important}}
`; }

  function mountFullscreen(){const ready=()=>{if(!document.body)return setTimeout(ready,30);document.title='Controle de Compras - UpSeller';const st=document.createElement('style');st.textContent=fullscreenStyles();document.head.appendChild(st);const app=document.createElement('div');app.id='kz-app';app.innerHTML=`<header class="kz-top"><div class="kz-brand"><div class="kz-logo">K</div><div><h1>Kryzer Compras</h1><p>v${VERSION} · Compras · Conferência · Recebimento</p></div></div><div class="kz-top-actions"><span class="kz-status">UpSeller conectado</span><button class="kz-close-app" id="kz-close-app">×</button></div></header><nav class="kz-tabs"><button class="kz-tab" data-tab="buy"><span>Comprar</span><small>Reposição de estoque</small></button><button class="kz-tab" data-tab="orders"><span>Pedidos</span><small>Aguardando compra</small></button><button class="kz-tab" data-tab="labels"><span>Etiquetas</span><small>Recebimento e impressão</small></button></nav><main class="kz-main"><aside class="kz-side" id="kz-side"></aside><section class="kz-content" id="kz-content"></section><aside class="kz-buy-summary" id="kz-buy-summary"></aside></main><div class="kz-loading" id="kz-loading"><div class="kz-loading-box"><div class="kz-spinner"></div><span>Carregando...</span></div></div>`;document.body.appendChild(app);$('#kz-close-app').onclick=()=>window.close();$$('.kz-tab').forEach(b=>b.onclick=async()=>{state.activeTab=b.dataset.tab;localStorage.setItem(STORAGE_ACTIVE_TAB,state.activeTab);await renderApp();});initializeApp();};ready();}
  async function initializeApp(){try{showLoading(true,'Preparando o painel...');await Promise.all([loadWarehouses(),loadSuppliers('')]);await renderApp();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}
  function setActiveTab(){$$('.kz-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.activeTab));}
  async function renderApp(){setActiveTab();const app=$('#kz-app');if(app)app.dataset.kzTab=state.activeTab;if(state.activeTab==='orders'){renderBuySummary();return renderOrdersTab();}if(state.activeTab==='labels'){renderBuySummary();return renderLabelsTab();}return renderBuyTab();}
  function warehouseOptions(all=false){return `${all?'<option value="">Todos os armazéns</option>':'<option value="">Selecione</option>'}${state.warehouses.map(w=>`<option value="${esc(w.idStr)}" ${String(w.idStr)===String(state.selectedWarehouseId)?'selected':''}>${esc(w.warehouseName)}</option>`).join('')}`;}
  function supplierOptions(){return `<option value="">Selecione</option>${state.suppliers.map(s=>`<option value="${esc(s.idStr||s.id)}" ${String(s.idStr||s.id)===String(state.selectedSupplierId)?'selected':''}>${esc(s.companyName)}</option>`).join('')}`;}

  async function loadBuyData(){if(!state.selectedWarehouseId)throw new Error('Selecione o armazém.');await Promise.all([loadInventory(state.selectedWarehouseId),loadShortages(state.selectedWarehouseId)]);const shortageMap=new Map(state.shortages.map(i=>[String(i.skuId),i]));const ids=new Set(state.inventory.map(i=>String(i.skuId)));for(const s of state.shortages){if(ids.has(String(s.skuId)))continue;try{const found=await searchSku(s.sku);const exact=found.find(i=>String(i.idStr||i.id)===String(s.skuId)||normSku(i.sku)===normSku(s.sku));if(!exact)continue;state.inventory.push({warehouseId:state.selectedWarehouseId,skuId:exact.idStr||exact.id,sku:exact.sku,skuTitle:exact.title||exact.titleAlias||exact.sku,imgUrl:exact.imgUrl||s.imgUrl||'',onhand:0,available:num(s.available),lowStockValue:0,maxStock:0,procureTransitNum:0,transitNum:0,costPrice:num(exact.costPrice)});}catch(e){console.warn(e);}}state.buyRows.clear();state.inventory.forEach(i=>{const sh=shortageMap.get(String(i.skuId));const caminho=Math.max(num(i.procureTransitNum),num(i.transitNum));const esgotado=num(sh?.shortage),estoque=num(i.available),minimo=num(i.lowStockValue),maximo=num(i.maxStock),sugestao=Math.max(0,maximo-estoque-caminho+esgotado);state.buyRows.set(String(i.skuId),{...i,caminho,esgotado,estoque,minimo,maximo,sugestao,qty:sugestao,selected:false,tag:state.tags[i.sku]||''});});}
  function buyStatusKey(row){
    const estoque=int(row.estoque),minimo=int(row.minimo),maximo=int(row.maximo);
    if(estoque<=0)return 'red';
    if(minimo>0&&estoque<minimo)return 'orange';
    if(maximo>0&&estoque<maximo)return 'yellow';
    if(maximo>0&&estoque>=maximo)return 'green';
    return 'none';
  }
  function buyMatchesStatusFilters(row){
    const filters=state.buyStatusFilters||[];
    if(!filters.length)return true;
    return filters.some(f=>f==='noSuggestion'?int(row.sugestao)<=0&&int(row.qty)<=0:buyStatusKey(row)===f);
  }
  function toggleBuyStatusFilter(key){
    const set=new Set(state.buyStatusFilters||[]);
    if(set.has(key))set.delete(key);else set.add(key);
    state.buyStatusFilters=[...set];
    if(key==='noSuggestion'&&set.has('noSuggestion'))state.buyOnlySuggested=false;
    renderBuyRows();
  }
  function filteredBuyRows(){let rows=[...state.buyRows.values()].filter(r=>wildcardMatches(`${r.sku} ${r.skuTitle} ${r.tag||''}`,state.buySearch)&&(!state.buyOnlyShortage||r.esgotado>0)&&(!state.buyOnlySuggested||r.sugestao>0||r.qty>0)&&buyMatchesStatusFilters(r));rows.sort((a,b)=>state.buySort==='title'?String(a.skuTitle||'').localeCompare(String(b.skuTitle||''),'pt-BR',{numeric:true}):skuCompare(a.sku,b.sku));return rows;}
  const selectedBuyRows=()=>[...state.buyRows.values()].filter(r=>r.selected);

  function renderBuyTab(){$('#kz-side').innerHTML=`<section class="kz-card"><div class="kz-card-head"><h3>Origem do pedido</h3></div><div class="kz-card-body"><div class="kz-field"><label class="kz-label">Armazém</label><select class="kz-select" id="buy-wh">${warehouseOptions()}</select></div><div class="kz-field"><label class="kz-label">Fornecedor</label><select class="kz-select" id="buy-supplier">${supplierOptions()}</select></div><div class="kz-button-stack"><button class="kz-btn primary" id="buy-load">Carregar produtos</button></div></div></section><section class="kz-card"><div class="kz-card-head"><h3>Filtros</h3></div><div class="kz-card-body"><div class="kz-field"><label class="kz-label">SKU, título ou tag</label><input class="kz-input" id="buy-search" value="${esc(state.buySearch)}" placeholder="Ex.: 504% ou vermelho"></div><div class="kz-field"><label class="kz-label">Ordenar por</label><select class="kz-select" id="buy-sort"><option value="sku" ${state.buySort==='sku'?'selected':''}>SKU</option><option value="title" ${state.buySort==='title'?'selected':''}>Título</option></select></div><label class="kz-check"><input type="checkbox" id="buy-only-short" ${state.buyOnlyShortage?'checked':''}>Apenas esgotados</label><label class="kz-check"><input type="checkbox" id="buy-only-suggested" ${state.buyOnlySuggested?'checked':''}>Apenas com sugestão</label></div></section><section class="kz-card"><div class="kz-card-head"><h3>Ações</h3></div><div class="kz-card-body"><div class="kz-button-stack"><button class="kz-btn secondary" id="buy-select-visible">Marcar visíveis</button><button class="kz-btn secondary" id="buy-unselect-all">Desmarcar todos</button><button class="kz-btn ghost" id="buy-print-labels">Imprimir etiquetas</button><button class="kz-btn success" id="buy-create">Criar pedido e PDF</button></div></div></section>`;$('#kz-content').innerHTML=`<div id="buy-stats"></div><section class="kz-card"><div class="kz-toolbar"><div class="kz-toolbar-left"><strong>Produtos para compra</strong><span class="kz-muted" id="buy-count"></span></div><div class="kz-toolbar-right">
  <span class="kz-badge green kz-filter-badge" data-buy-status="green">No máximo ou acima</span>
  <span class="kz-badge yellow kz-filter-badge" data-buy-status="yellow">Abaixo do máximo</span>
  <span class="kz-badge orange kz-filter-badge" data-buy-status="orange">Abaixo do mínimo</span>
  <span class="kz-badge red kz-filter-badge" data-buy-status="red">Estoque zerado</span>
  <span class="kz-badge gray kz-filter-badge" data-buy-status="noSuggestion">Sem sugestão</span>
  <span class="kz-badge clear kz-filter-badge" data-buy-status="clear">Limpar filtros</span>
</div></div><div id="buy-table"></div></section>`;$$('[data-buy-status]').forEach(b=>{const key=b.dataset.buyStatus;b.onclick=()=>{if(key==='clear')state.buyStatusFilters=[];else toggleBuyStatusFilter(key);renderBuyRows();};});$('#buy-wh').onchange=e=>state.selectedWarehouseId=e.target.value;$('#buy-supplier').onchange=e=>{state.selectedSupplierId=e.target.value;state.selectedSupplierName=e.target.selectedOptions[0]?.textContent?.trim()||'';};$('#buy-load').onclick=async()=>{state.selectedWarehouseId=$('#buy-wh').value;state.selectedSupplierId=$('#buy-supplier').value;state.selectedSupplierName=$('#buy-supplier').selectedOptions[0]?.textContent?.trim()||'';try{showLoading(true,'Carregando estoque e produtos esgotados...');await loadBuyData();renderBuyRows();toast('Produtos carregados.');}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}};$('#buy-search').oninput=e=>{state.buySearch=e.target.value;renderBuyRows();};$('#buy-sort').onchange=e=>{state.buySort=e.target.value;renderBuyRows();};$('#buy-only-short').onchange=e=>{state.buyOnlyShortage=e.target.checked;renderBuyRows();};$('#buy-only-suggested').onchange=e=>{state.buyOnlySuggested=e.target.checked;renderBuyRows();};$('#buy-select-visible').onclick=()=>{filteredBuyRows().forEach(r=>r.selected=true);renderBuyRows();};$('#buy-unselect-all').onclick=()=>{state.buyRows.forEach(r=>r.selected=false);renderBuyRows();};$('#buy-print-labels').onclick=openBuyLabelsModal;$('#buy-create').onclick=createPurchaseOrder;renderBuyRows();}
  function buyStockRowClass(row){
    const key=buyStatusKey(row);
    return key==='none'?'':`kz-stock-${key}`;
  }

  function renderBuySummary(){
    const box=$('#kz-buy-summary');
    if(!box)return;
    const selected=selectedBuyRows().filter(r=>int(r.qty)>0);
    const pieces=selected.reduce((sum,r)=>sum+int(r.qty),0);
    const estimated=selected.reduce((sum,r)=>sum+(num(r.costPrice)*int(r.qty)),0);
    const warehouse=$('#buy-wh')?.selectedOptions?.[0]?.textContent?.trim()||'Armazém não selecionado';
    const supplier=$('#buy-supplier')?.selectedOptions?.[0]?.textContent?.trim()||'Fornecedor não selecionado';
    box.innerHTML=`<div class="kz-buy-summary-head"><div class="kz-buy-summary-eyebrow">Resumo da compra</div><div class="kz-buy-summary-title">Pedido em preparação</div><div class="kz-buy-summary-context" title="${esc(`${warehouse} · ${supplier}`)}">${esc(warehouse)} · ${esc(supplier)}</div></div><div class="kz-buy-summary-metrics"><div class="kz-buy-summary-metric"><span>SKUs</span><strong>${selected.length}</strong></div><div class="kz-buy-summary-metric"><span>Peças</span><strong>${pieces}</strong></div><div class="kz-buy-summary-metric"><span>Custo estimado</span><strong>${estimated.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}</strong></div></div><div class="kz-buy-summary-list">${selected.length?selected.sort((a,b)=>skuCompare(a.sku,b.sku)).map(r=>`<div class="kz-buy-summary-row">${r.imgUrl?`<img src="${esc(r.imgUrl)}" alt="">`:'<span class="kz-buy-summary-img"></span>'}<div class="kz-buy-summary-copy"><b>${esc(r.sku)}</b><small title="${esc(r.skuTitle)}">${esc(r.skuTitle)}</small></div><div class="kz-buy-summary-qty">${int(r.qty)}</div></div>`).join(''):'<div class="kz-buy-summary-empty">Marque os produtos na tabela. Antes de criar o pedido, todos os SKUs selecionados aparecerão aqui.</div>'}</div><div class="kz-buy-summary-actions"><button type="button" class="kz-buy-summary-create" id="kz-summary-create" ${selected.length?'':'disabled'}>Criar pedido e PDF</button><button type="button" class="kz-buy-summary-clear" id="kz-summary-clear" ${selected.length?'':'disabled'}>Limpar seleção</button></div>`;
    $('#kz-summary-create',box)?.addEventListener('click',()=>$('#buy-create')?.click());
    $('#kz-summary-clear',box)?.addEventListener('click',()=>$('#buy-unselect-all')?.click());
  }

  function renderBuyRows(){$$('[data-buy-status]').forEach(b=>b.classList.toggle('active',(state.buyStatusFilters||[]).includes(b.dataset.buyStatus)));const rows=filteredBuyRows(),selected=selectedBuyRows(),pieces=selected.reduce((s,r)=>s+int(r.qty),0);$('#buy-stats').innerHTML=`<div class="kz-stats"><div class="kz-stat"><span>SKUs listados</span><strong>${rows.length}</strong></div><div class="kz-stat"><span>SKUs selecionados</span><strong>${selected.length}</strong></div><div class="kz-stat"><span>Peças selecionadas</span><strong>${pieces}</strong></div><div class="kz-stat"><span>Esgotados listados</span><strong>${rows.filter(r=>r.esgotado>0).length}</strong></div><div class="kz-stat"><span>Sem sugestão</span><strong>${rows.filter(r=>int(r.sugestao)<=0).length}</strong></div></div>`;$('#buy-count').textContent=`${rows.length} SKU(s)`;if(!rows.length){$('#buy-table').innerHTML=`<div class="kz-empty">${state.buyRows.size?'Nenhum produto corresponde aos filtros.':'Selecione o armazém e clique em Carregar produtos.'}</div>`;renderBuySummary();return;}$('#buy-table').innerHTML=`<div class="kz-table-wrap kz-buy-table-wrap"><table class="kz-table"><thead><tr><th class="center"></th><th>Produto</th><th>Tag</th><th class="center">Mínimo</th><th class="center">Máximo</th><th class="center">Caminho</th><th class="center">Esgotado</th><th class="center">Estoque</th><th class="center">Sugestão</th><th class="center">Comprar</th></tr></thead><tbody>${rows.map(r=>`<tr class="${buyStockRowClass(r)}" data-id="${esc(r.skuId)}"><td class="center"><input type="checkbox" class="buy-check" ${r.selected?'checked':''}></td><td><div class="kz-product">${r.imgUrl?`<img src="${esc(r.imgUrl)}">`:'<span style="width:42px"></span>'}<div class="kz-product-title"><b>${esc(r.sku)}</b><span>${esc(r.skuTitle)}</span>${r.tag?`<em class="kz-tag">${esc(r.tag)}</em>`:''}</div></div></td><td><input class="kz-tag-input buy-tag" value="${esc(r.tag||'')}" placeholder="Tag"></td><td class="center">${int(r.minimo)}</td><td class="center">${int(r.maximo)}</td><td class="center">${int(r.caminho)}</td><td class="center">${r.esgotado>0?`<span class="kz-badge red">${int(r.esgotado)}</span>`:'0'}</td><td class="center">${int(r.estoque)}</td><td class="center"><strong>${int(r.sugestao)}</strong></td><td class="center"><input type="number" min="0" class="kz-qty buy-qty" value="${int(r.qty)}"></td></tr>`).join('')}</tbody></table></div>`;$$('#buy-table tr[data-id]').forEach(tr=>{const r=state.buyRows.get(tr.dataset.id);$('.buy-check',tr).onchange=e=>{r.selected=e.target.checked;renderBuyRows();};$('.buy-qty',tr).onchange=e=>{r.qty=Math.max(0,int(e.target.value));renderBuySummary();};$('.buy-tag',tr).onchange=e=>{r.tag=e.target.value.trim();state.tags[r.sku]=r.tag;saveJson(STORAGE_TAGS,state.tags);renderBuyRows();};});renderBuySummary();}

  function openBuyLabelsModal(){const selected=selectedBuyRows();if(!selected.length)return toast('Selecione pelo menos um produto.','error');const b=document.createElement('div');b.className='kz-modal-backdrop';b.innerHTML=`<div class="kz-modal"><div class="kz-modal-head"><h3>Imprimir etiquetas avulsas</h3><button class="kz-icon-btn" data-close>×</button></div><div class="kz-modal-body"><div class="kz-field" style="max-width:250px"><label class="kz-label">Modelo</label><select class="kz-select" id="buy-label-paper"><option value="50x25" ${state.paper==='50x25'?'selected':''}>50×25 mm · 2 colunas</option><option value="60x40" ${state.paper==='60x40'?'selected':''}>60×40 mm · 1 coluna</option></select></div><div class="kz-table-wrap"><table class="kz-table"><thead><tr><th>Produto</th><th class="center">Quantidade</th></tr></thead><tbody>${selected.sort((a,b)=>skuCompare(a.sku,b.sku)).map(r=>`<tr data-sku="${esc(r.sku)}"><td><div class="kz-product">${r.imgUrl?`<img src="${esc(r.imgUrl)}">`:''}<div class="kz-product-title"><b>${esc(r.sku)}</b><span>${esc(r.skuTitle)}</span></div></div></td><td class="center"><input type="number" min="1" class="kz-qty modal-label-qty" value="${Math.max(1,int(r.qty)||1)}"></td></tr>`).join('')}</tbody></table></div></div><div class="kz-modal-foot"><button class="kz-btn secondary" data-close>Cancelar</button><button class="kz-btn primary" id="buy-label-print">Imprimir</button></div></div>`;b.onclick=e=>{if(e.target.dataset.close!==undefined)b.remove();};document.body.appendChild(b);$('#buy-label-print',b).onclick=()=>{state.paper=$('#buy-label-paper',b).value;localStorage.setItem(STORAGE_PAPER,state.paper);const items=$$('tbody tr',b).map(tr=>{const r=selected.find(x=>x.sku===tr.dataset.sku);return{sku:r.sku,title:r.skuTitle,image:r.imgUrl,qty:Math.max(1,int($('.modal-label-qty',tr).value)),size:sizeFromSku(r.sku)};});buildLabelPrintWindow(items,false);b.remove();};}
  async function createPurchaseOrder(){
    state.selectedWarehouseId = $('#buy-wh')?.value || state.selectedWarehouseId;
    state.selectedSupplierId = $('#buy-supplier')?.value || state.selectedSupplierId;
    state.selectedSupplierName = $('#buy-supplier')?.selectedOptions?.[0]?.textContent?.trim() || state.selectedSupplierName;
    const items=selectedBuyRows().filter(r=>int(r.qty)>0);
    if(!state.selectedWarehouseId){ await alertBox('Armazém obrigatório','Selecione o armazém antes de criar o pedido.'); return; }
    if(!state.selectedSupplierId){ await alertBox('Fornecedor obrigatório','Selecione o fornecedor antes de criar o pedido.'); return; }
    if(!items.length){ await alertBox('Nenhum produto selecionado','Marque pelo menos um produto e informe uma quantidade maior que zero.'); return; }const total=items.reduce((s,r)=>s+int(r.qty),0),ok=await confirmBox({title:'Criar pedido',html:`<p><strong>Fornecedor:</strong> ${esc(state.selectedSupplierName)}</p><p><strong>SKUs:</strong> ${items.length}</p><p><strong>Peças:</strong> ${total}</p><p>O pedido será salvo em <strong>Para Comprar</strong> e o PDF será aberto.</p>`,confirmText:'Criar e gerar PDF'});if(!ok)return;const payload={warehouseId:String(state.selectedWarehouseId),supplierName:state.selectedSupplierName,trackingNo:'',expectedTime:null,note:'',inboundType:0,supplierId:Number(state.selectedSupplierId),currency:'BRL',discountCost:'',shippingCost:'',otherFee:'',details:items.map(r=>({skuId:String(r.skuId),qty:int(r.qty),costPrice:num(r.costPrice),sku:r.sku})),operateType:0};try{showLoading(true,'Criando pedido...');const id=await savePurchaseOrder(payload);await loadPurchaseOrders(state.selectedWarehouseId);const order=state.purchaseOrders.find(o=>String(o.id)===String(id))||state.purchaseOrders[0];if(order)buildPurchasePdf(order);state.buyRows.forEach(r=>r.selected=false);toast('Pedido criado com sucesso.');state.activeTab='orders';localStorage.setItem(STORAGE_ACTIVE_TAB,state.activeTab);await renderOrdersTab();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}

  async function renderOrdersTab(){$('#kz-side').innerHTML=`<section class="kz-card"><div class="kz-card-head"><h3>Pedidos</h3></div><div class="kz-card-body"><div class="kz-field"><label class="kz-label">Armazém</label><select class="kz-select" id="orders-wh">${warehouseOptions(true)}</select></div><div class="kz-field"><label class="kz-label">PO, fornecedor, SKU ou título</label><input class="kz-input" id="orders-search" placeholder="Use % como coringa"></div><div class="kz-button-stack"><button class="kz-btn primary" id="orders-refresh">Atualizar pedidos</button></div></div></section>`;$('#kz-content').innerHTML='<div id="orders-stats"></div><div id="orders-grid"></div>';$('#orders-wh').onchange=e=>state.selectedWarehouseId=e.target.value;$('#orders-refresh').onclick=refreshPurchaseOrders;$('#orders-search').oninput=renderOrderCards;await refreshPurchaseOrders();}
  async function refreshPurchaseOrders(){try{showLoading(true,'Carregando pedidos para comprar...');const wh=$('#orders-wh')?.value??state.selectedWarehouseId;state.selectedWarehouseId=wh;await loadPurchaseOrders(wh);renderOrderCards();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}
  function renderOrderCards(){const q=$('#orders-search')?.value||'',orders=state.purchaseOrders.filter(o=>wildcardMatches([o.commonNo,o.supplierName,o.warehouseName,...(o.detailsVOList||[]).flatMap(i=>[i.sku,i.skuTitle])].join(' '),q));$('#orders-stats').innerHTML=`<div class="kz-stats"><div class="kz-stat"><span>Pedidos aguardando</span><strong>${orders.length}</strong></div><div class="kz-stat"><span>SKUs</span><strong>${orders.reduce((s,o)=>s+int(o.skuQty),0)}</strong></div><div class="kz-stat"><span>Peças</span><strong>${orders.reduce((s,o)=>s+int(o.procureQty),0)}</strong></div><div class="kz-stat"><span>Armazéns</span><strong>${new Set(orders.map(o=>o.warehouseId)).size}</strong></div></div>`;if(!orders.length){$('#orders-grid').innerHTML='<div class="kz-empty">Nenhum pedido em Para Comprar.</div>';return;}$('#orders-grid').innerHTML=`<div class="kz-order-grid">${orders.map(o=>`<article class="kz-order-card"><div class="kz-order-card-top"><div><div class="kz-order-no">${esc(o.commonNo||o.idStr)}</div><div class="kz-order-meta">${esc(o.supplierName||'-')} · ${esc(o.warehouseName||'-')}</div><div class="kz-order-meta">${esc(formatDate(o.createTime))}</div></div><span class="kz-badge yellow">Aguardando</span></div><div class="kz-order-body"><div class="kz-order-stats"><div><strong>${int(o.skuQty)}</strong><span>SKUs</span></div><div><strong>${int(o.procureQty)}</strong><span>Peças</span></div></div></div><div class="kz-order-actions"><button class="kz-btn secondary small" data-pdf="${esc(o.id)}">Gerar PDF</button><button class="kz-btn primary small" data-confer="${esc(o.id)}">Conferir</button></div></article>`).join('')}</div>`;$$('[data-pdf]').forEach(b=>b.onclick=()=>{const o=state.purchaseOrders.find(x=>String(x.id)===String(b.dataset.pdf));if(o)buildPurchasePdf(o);});$$('[data-confer]').forEach(b=>b.onclick=()=>openOrderEditor(b.dataset.confer));}
  async function openOrderEditor(id){try{showLoading(true,'Abrindo pedido...');const o=await getPurchaseOrder(id);o.__items=(o.detailsVOList||[]).map(i=>({...i,originalQty:int(i.qty),qty:0,receivedQty:0,removed:false,added:false}));o.__history=[];state.currentOrder=o;state.editorInventory=[];const wh=String(o.warehouseId||o.warehouseIdStr||state.selectedWarehouseId||'');if(wh){showLoading(true,'Carregando produtos do armazém do pedido...');state.editorInventory=await loadInventoryForWarehouse(wh);}renderOrderEditor();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}
  function logEditorHistory(text){const o=state.currentOrder;if(!o)return;o.__history=o.__history||[];o.__history.unshift({text,time:new Date()});if(o.__history.length>200)o.__history.length=200;renderEditorHistory();}
  function renderEditorHistory(){const el=$('#editor-history');if(!el)return;const hist=state.currentOrder?.__history||[];el.innerHTML=hist.length?hist.map(h=>`<div class="kz-history-item"><span class="kz-history-time">${h.time.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span>${esc(h.text)}</span></div>`).join(''):'<div class="kz-muted">Nenhuma alteração ainda.</div>';}
  const sortedEditorItems=()=>[...(state.currentOrder?.__items||[])].sort((a,b)=>skuCompare(a.sku,b.sku));
  // UpSeller recusa add-procure com "Inventory.Error.Product_has_been_deleted"
  // quando um skuId do pedido não existe mais no cadastro (produto excluído
  // ou substituído depois que o pedido foi criado) — sem dizer qual item é.
  // Cruza contra a lista de estoque do armazém (a mesma usada pra pesquisa)
  // pra avisar qual SKU provavelmente é o problema ANTES de tentar salvar,
  // em vez de deixar o erro genérico estourar só na resposta da API.
  function findMissingFromInventory(items){
    const inv=state.editorInventory||[];
    if(!inv.length)return [];
    const ids=new Set(inv.map(x=>String(x.skuId||x.idStr||x.id)));
    return items.filter(i=>!ids.has(String(i.skuId||i.idStr||i.id)));
  }
  async function warnIfMissingFromInventory(items){
    const missing=findMissingFromInventory(items);
    if(!missing.length)return false;
    const exemplos=missing.map(i=>i.sku).join(', ');
    const ok=await confirmBox({
      title:'Produto pode ter sido excluído do catálogo',
      html:`<p>${missing.length} produto(s) não foram encontrados na lista atual de estoque do armazém — provavelmente foram excluídos ou substituídos no UpSeller depois que o pedido foi criado (é essa a causa mais comum do erro "Inventory.Error.Product_has_been_deleted").</p><p><strong>SKU(s) suspeito(s):</strong> ${esc(exemplos)}</p><p>Recomendado: clique em "Atualizar estoque" e confira antes de continuar. Se tiver certeza que estão certos, pode prosseguir mesmo assim.</p>`,
      confirmText:'Salvar mesmo assim',
      danger:true
    });
    return !ok;
  }
  function renderOrderEditor(){const o=state.currentOrder;$('#kz-side').innerHTML=`<section class="kz-card"><div class="kz-card-head"><h3>${esc(o.commonNo||o.idStr)}</h3></div><div class="kz-card-body"><div class="kz-muted">${esc(o.supplierName)}<br>${esc(o.warehouseName)}</div><div class="kz-button-stack" style="margin-top:12px"><button class="kz-btn secondary" id="editor-back">Voltar aos pedidos</button><button class="kz-btn ghost" id="editor-pdf">Gerar PDF</button><button class="kz-btn secondary" id="editor-save">Salvar sem finalizar</button><button class="kz-btn success" id="editor-received">Recebido</button></div></div></section><section class="kz-card"><div class="kz-card-head"><h3>Histórico</h3></div><div class="kz-card-body" id="editor-history"></div></section>`;$('#kz-content').innerHTML=`<section class="kz-card"><div class="kz-card-head"><h3>Adicionar produto</h3><span class="kz-muted">Pesquisa por SKU ou nome no armazém do pedido · use %</span></div><div class="kz-card-body" style="position:relative"><div class="kz-toolbar" style="padding:0 0 8px"><div class="kz-toolbar-left" style="flex:1"><input class="kz-input" id="editor-search" placeholder="Digite SKU ou nome"></div><div class="kz-toolbar-right"><button class="kz-btn secondary small" id="editor-refresh-inventory">Atualizar estoque</button></div></div><div id="editor-search-results"></div></div></section><section class="kz-card"><div class="kz-toolbar"><div class="kz-toolbar-left"><strong>Conferência</strong><span class="kz-muted">${o.__items.length} SKU(s) · itens iniciam com recebido 0</span></div></div><div id="editor-table"></div></section>`;$('#editor-back').onclick=renderOrdersTab;$('#editor-pdf').onclick=()=>buildPurchasePdf(editorSnapshot());$('#editor-save').onclick=()=>saveOrderDraft();$('#editor-received').onclick=()=>finalizePurchaseOrder();$('#editor-refresh-inventory').onclick=async()=>{try{const wh=String(state.currentOrder?.warehouseId||state.currentOrder?.warehouseIdStr||state.selectedWarehouseId||'');if(!wh)return toast('Armazém do pedido não localizado.','error');showLoading(true,'Atualizando lista de estoque do armazém...');state.editorInventory=await loadInventoryForWarehouse(wh);toast('Lista de estoque atualizada.');const v=$('#editor-search')?.value?.trim();if(v)await searchEditorSku(v);}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}};let timer;$('#editor-search').oninput=e=>{clearTimeout(timer);const v=e.target.value.trim();if(v.length<1)return $('#editor-search-results').innerHTML='';timer=setTimeout(()=>searchEditorSku(v),300);};renderEditorTable();renderEditorHistory();}
  function renderEditorTable(){const items=sortedEditorItems();$('#editor-table').innerHTML=`<div class="kz-table-wrap"><table class="kz-table"><thead><tr><th>Produto</th><th class="center">Original</th><th class="center">Recebido</th><th class="center">Atalhos</th><th class="center">Situação</th><th></th></tr></thead><tbody>${items.map(i=>{const changed=int(i.qty)!==int(i.originalQty),status=i.removed?'<span class="kz-badge red kz-badge-clickable" data-purge title="Clique para tirar este item da lista">Removido</span>':i.added?'<span class="kz-badge blue">Adicionado</span>':changed?'<span class="kz-badge yellow">Alterado</span>':'<span class="kz-badge green">Igual</span>';const justAdded=i.__justAddedAt&&(Date.now()-i.__justAddedAt)<5000;return`<tr class="${!i.removed&&int(i.qty)<=0?'kz-editor-zero':''}${justAdded?' kz-row-flash':''}" data-sku-id="${esc(i.skuId)}"><td><div class="kz-product">${i.skuImage?`<img src="${esc(i.skuImage)}">`:''}<div class="kz-product-title"><b>${esc(i.sku)}</b><span>${esc(i.skuTitle)}</span></div></div></td><td class="center">${int(i.originalQty)}</td><td class="center"><input type="number" min="0" class="kz-qty editor-qty" value="${int(i.qty)}" ${i.removed?'disabled':''}></td><td class="center"><button class="kz-btn secondary small" data-add="1">+1</button> <button class="kz-btn secondary small" data-add="5">+5</button> <button class="kz-btn secondary small" data-add="10">+10</button></td><td class="center">${status}</td><td><button class="kz-btn ${i.removed?'secondary':'danger'} small" data-remove>${i.removed?'Restaurar':'Remover'}</button></td></tr>`;}).join('')}</tbody></table></div>`;$$('#editor-table tr[data-sku-id]').forEach(tr=>{const i=state.currentOrder.__items.find(x=>String(x.skuId)===String(tr.dataset.skuId));$('.editor-qty',tr).onchange=e=>{const before=int(i.qty);const after=Math.max(0,int(e.target.value));if(after===before)return;i.qty=after;const delta=after-before;logEditorHistory(`Manual ${i.sku}: ${before} → ${after} (${delta>=0?'+':''}${delta})`);renderEditorTable();};$$('[data-add]',tr).forEach(b=>b.onclick=()=>{if(i.removed)return;const delta=int(b.dataset.add);i.qty=int(i.qty)+delta;playTickSound();logEditorHistory(`+${delta} ${i.sku} (atalho)`);renderEditorTable();});$('[data-remove]',tr).onclick=()=>{i.removed=!i.removed;if(!i.removed&&int(i.qty)<=0&&!i.added)i.qty=0;logEditorHistory(`${i.removed?'Removeu':'Restaurou'} ${i.sku}`);renderEditorTable();};$('[data-purge]',tr)?.addEventListener('click',()=>{const idx=state.currentOrder.__items.indexOf(i);if(idx>-1)state.currentOrder.__items.splice(idx,1);renderEditorTable();});});if($('#editor-table tr.kz-row-flash'))setTimeout(renderEditorTable,5200);}
  async function searchEditorSku(value){try{$('#editor-search-results').innerHTML='<div class="kz-search-results"><div class="kz-search-item">Buscando no armazém do pedido...</div></div>';if(!state.editorInventory.length){const wh=String(state.currentOrder?.warehouseId||state.currentOrder?.warehouseIdStr||state.selectedWarehouseId||'');if(wh)state.editorInventory=await loadInventoryForWarehouse(wh);}let results=[...(state.editorInventory||[])].filter(i=>wildcardMatches(`${i.sku} ${i.skuTitle||i.title||i.titleAlias||i.productName||''}`,value));state.orderSearchResults=results;$('#editor-search-results').innerHTML=`<div class="kz-search-results">${results.slice(0,50).map(i=>{const id=i.idStr||i.id||i.skuId;return`<div class="kz-search-item" data-result-id="${esc(id)}">${(i.imgUrl||i.skuImage)?`<img src="${esc(i.imgUrl||i.skuImage)}">`:''}<div><b>${esc(i.sku)}</b><span>${esc(i.skuTitle||i.title||i.titleAlias||i.sku)}</span></div></div>`;}).join('')||'<div class="kz-search-item">Nenhum produto encontrado. Se você acabou de criar o SKU, clique em Atualizar estoque e pesquise novamente.</div>'}</div>`;$$('[data-result-id]').forEach(el=>el.onclick=()=>{const i=state.orderSearchResults.find(x=>String(x.idStr||x.id||x.skuId)===String(el.dataset.resultId));if(i)addSkuToOrder(i);});}catch(e){console.error(e);$('#editor-search-results').innerHTML='';toast(e.message,'error');}}
  function addSkuToOrder(s){const id=s.idStr||s.id||s.skuId,ex=state.currentOrder.__items.find(i=>String(i.skuId)===String(id));if(ex){ex.removed=false;ex.__justAddedAt=Date.now();logEditorHistory(`Adicionou ${ex.sku} (já estava no pedido)`);toast('O produto já existe no pedido.');}else{const item={id:null,procureId:state.currentOrder.id,skuId:id,sku:s.sku,qty:0,originalQty:0,receivedQty:0,costPrice:num(s.costPrice),procurePrice:num(s.costPrice),skuTitle:s.skuTitle||s.title||s.titleAlias||s.productName||s.sku,skuImage:s.imgUrl||s.skuImage||'',added:true,removed:false,__justAddedAt:Date.now()};state.currentOrder.__items.push(item);logEditorHistory(`Adicionou ${item.sku} (pesquisa)`);toast('Produto adicionado com quantidade 0.');}$('#editor-search').value='';$('#editor-search-results').innerHTML='';renderEditorTable();setTimeout(renderEditorTable,5200);}
  function editorSnapshot(){const o=state.currentOrder,details=sortedEditorItems().filter(i=>!i.removed&&int(i.qty)>0);return{...o,skuQty:details.length,procureQty:details.reduce((s,i)=>s+int(i.qty),0),detailsVOList:details};}
  // "Salvar sem finalizar": grava as alterações no pedido mas mantém ele em
  // Para Comprar (não passa por recebimento/Em Trânsito) — reusa o mesmo
  // add-procure com operateType:0, o mesmo valor usado ao CRIAR um pedido
  // novo (que também fica em Para Comprar), em vez do operateType:1 usado
  // no recebimento. Ainda não confirmado por captura de rede — ao usar pela
  // primeira vez, confira na lista de pedidos que ele permaneceu em Para
  // Comprar antes de confiar nisso pra valer.
  async function saveOrderDraft(){
    try{
      const o=state.currentOrder;
      if(!o)return alertBox('Pedido não carregado','Abra o pedido novamente antes de salvar.');
      const items=sortedEditorItems().filter(i=>!i.removed);
      if(!items.length){await alertBox('Pedido vazio','O pedido não pode ficar sem nenhum produto. Adicione pelo menos um SKU ou remova o salvamento.');return;}
      if(await warnIfMissingFromInventory(items))return;

      const payload={
        id:String(o.idStr||o.id),
        warehouseId:String(o.warehouseId||o.warehouseIdStr||state.selectedWarehouseId||''),
        supplierName:o.supplierName||'',
        trackingNo:o.trackingNo||'',
        expectedTime:o.expectedTime||null,
        note:o.note||'',
        inboundType:Number(o.inboundType||0),
        supplierId:Number(o.supplierId||0),
        currency:o.currency||'BRL',
        discountCost:o.discountCost??'',
        shippingCost:o.shippingCost??'',
        otherFee:o.otherFee??'',
        details:items.map(i=>({
          skuId:String(i.skuId||i.idStr||i.id),
          qty:int(i.qty),
          costPrice:num(i.costPrice||i.procurePrice),
          sku:i.sku
        })),
        operateType:0
      };

      if(!payload.id)throw new Error('ID do pedido não localizado.');
      if(!payload.warehouseId)throw new Error('Armazém do pedido não localizado.');
      if(!payload.details.length)throw new Error('Nenhum item válido para enviar.');

      showLoading(true,'Salvando alterações do pedido...');
      await savePurchaseOrder(payload);
      toast('Pedido salvo — continua em Para Comprar.');
      logEditorHistory('Pedido salvo sem finalizar');
      o.__items=o.__items.filter(i=>!i.removed).map(i=>({...i,originalQty:int(i.qty),added:false}));
      renderEditorTable();
    }catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}
  }
  async function finalizePurchaseOrder(){
    try{
      const o=state.currentOrder;
      if(!o)return alertBox('Pedido não carregado','Abra o pedido novamente antes de receber.');

      const items=sortedEditorItems().filter(i=>!i.removed);
      const zeros=items.filter(i=>int(i.qty)<=0);

      if(zeros.length){
        const exemplos=zeros.slice(0,8).map(i=>i.sku).join(', ');
        await alertBox(
          'Quantidade recebida pendente',
          `Existem ${zeros.length} produto(s) com quantidade recebida igual a 0. Confira e informe a quantidade recebida ou remova o item antes de salvar.${exemplos?` SKUs pendentes: ${exemplos}${zeros.length>8?'...':''}`:''}`
        );
        return;
      }

      if(!items.length){
        await alertBox('Pedido vazio','O pedido não pode ficar sem nenhum produto. Adicione pelo menos um SKU ou volte sem salvar.');
        return;
      }

      if(await warnIfMissingFromInventory(items))return;

      const changed=o.__items.filter(i=>i.removed||i.added||int(i.qty)!==int(i.originalQty));
      const ok=await confirmBox({
        title:'Confirmar recebimento',
        html:`<p>O pedido será atualizado e movido para <strong>Em Trânsito</strong>.</p><p><strong>Pedido:</strong> ${esc(o.commonNo)}</p><p><strong>SKUs recebidos:</strong> ${items.length}</p><p><strong>Peças recebidas:</strong> ${items.reduce((s,i)=>s+int(i.qty),0)}</p><p><strong>Itens alterados/removidos/adicionados:</strong> ${changed.length}</p>`,
        confirmText:'Confirmar recebimento'
      });
      if(!ok)return;

      const payload={
        id:String(o.idStr||o.id),
        warehouseId:String(o.warehouseId||o.warehouseIdStr||state.selectedWarehouseId||''),
        supplierName:o.supplierName||'',
        trackingNo:o.trackingNo||'',
        expectedTime:o.expectedTime||null,
        note:o.note||'',
        inboundType:Number(o.inboundType||0),
        supplierId:Number(o.supplierId||0),
        currency:o.currency||'BRL',
        discountCost:o.discountCost??'',
        shippingCost:o.shippingCost??'',
        otherFee:o.otherFee??'',
        details:items.map(i=>({
          skuId:String(i.skuId||i.idStr||i.id),
          qty:int(i.qty),
          costPrice:num(i.costPrice||i.procurePrice),
          sku:i.sku
        })),
        operateType:1,
        receiveType:0
      };

      if(!payload.id)throw new Error('ID do pedido não localizado.');
      if(!payload.warehouseId)throw new Error('Armazém do pedido não localizado.');
      if(!payload.details.length)throw new Error('Nenhum item válido para enviar.');

      showLoading(true,'Movendo pedido para Em Trânsito...');
      await savePurchaseOrder(payload);
      toast('Pedido movido para Em Trânsito.');
      state.currentOrder=null;
      await renderOrdersTab();
    }catch(e){
      console.error(e);
      await alertBox('Erro ao receber pedido', e.message || String(e));
    }finally{
      showLoading(false);
    }
  }

  async function renderLabelsTab(){$('#kz-side').innerHTML=`<section class="kz-card"><div class="kz-card-head"><h3>Etiquetas</h3></div><div class="kz-card-body"><div class="kz-field"><label class="kz-label">Armazém</label><select class="kz-select" id="labels-wh">${warehouseOptions(true)}</select></div><div class="kz-field"><label class="kz-label">Modelo</label><select class="kz-select" id="labels-paper"><option value="50x25" ${state.paper==='50x25'?'selected':''}>50×25 mm · 2 colunas</option><option value="60x40" ${state.paper==='60x40'?'selected':''}>60×40 mm · 1 coluna</option></select></div><div class="kz-field"><label class="kz-label">SKU, título ou pedido</label><input class="kz-input" id="labels-search" value="${esc(state.labelsSearch)}" placeholder="Use % como coringa"></div><label class="kz-check"><input type="checkbox" id="labels-only-short" ${state.labelsOnlyShortage?'checked':''}>Apenas esgotados</label><label class="kz-check"><input type="checkbox" id="labels-full-mode" ${state.fullLabelMode?'checked':''}>Imprimir etiqueta do Full</label>
          <div class="kz-field"><label class="kz-label">Tamanho rápido</label>
            <div class="kz-size-filter" id="labels-size-filter">
              ${['ALL','PP','P','M','G','GG'].map(size=>`<button type="button" class="kz-size-btn ${(state.labelsSize||'ALL')===size?'active':''}" data-size="${size}">${size==='ALL'?'Todos':size}</button>`).join('')}
            </div>
          </div>
          <div class="kz-button-stack"><button class="kz-btn primary" id="labels-refresh">Atualizar etiquetas</button></div></div></section>
          <section class="kz-card"><div class="kz-card-head"><h3>Etiqueta avulsa</h3></div><div class="kz-card-body"><div class="kz-field"><label class="kz-label">SKU ou nome</label><input class="kz-input" id="loose-label-search" placeholder="Pesquise no estoque"></div><div class="kz-field"><label class="kz-label">Qtd para adicionar</label><input type="number" min="1" class="kz-input" id="loose-label-qty" value="1"></div><div style="position:relative"><div id="loose-label-results"></div></div><div class="kz-field"><label class="kz-label">Itens avulsos</label><div id="loose-label-items" class="kz-loose-list"></div></div><div class="kz-field"><label class="kz-label">Qtd em massa</label><input type="number" min="1" class="kz-input" id="loose-bulk-qty" placeholder="Ex: 10"></div><div class="kz-mini-actions"><button class="kz-btn secondary small" id="loose-apply-bulk">Aplicar qtd</button><button class="kz-btn ghost small" id="loose-clear">Limpar</button></div><div style="margin-top:7px"><button class="kz-btn success" style="width:100%" id="loose-print">Imprimir avulsas</button></div><div class="kz-muted" style="margin-top:8px">Use a etiqueta avulsa para imprimir SKUs fora de pedido. Ela não registra recebimento no UpSeller.</div></div></section>`;$('#kz-content').innerHTML='<div id="labels-stats"></div><div id="labels-orders"></div>';$('#labels-wh').onchange=e=>{state.selectedWarehouseId=e.target.value;state.labelInventoryWarehouseId='';state.labelInventory=[];};$('#labels-paper').onchange=e=>{state.paper=e.target.value;localStorage.setItem(STORAGE_PAPER,state.paper);};$('#labels-search').oninput=e=>{state.labelsSearch=e.target.value;renderLabelsOrders();};$('#labels-only-short').onchange=e=>{state.labelsOnlyShortage=e.target.checked;renderLabelsOrders();};$('#labels-full-mode').onchange=async e=>{state.fullLabelMode=e.target.checked;if(state.fullLabelMode&&!state.fullInventoryMap){try{showLoading(true,'Carregando produtos do Full...');await fetchFullInventoryMap();}catch(err){console.error(err);toast(err.message,'error');state.fullLabelMode=false;e.target.checked=false;}finally{showLoading(false);}}};$$('[data-size]',$('#labels-size-filter')).forEach(btn=>btn.onclick=()=>{state.labelsSize=btn.dataset.size;$$('[data-size]',$('#labels-size-filter')).forEach(x=>x.classList.toggle('active',x===btn));renderLabelsOrders();});$('#labels-refresh').onclick=refreshLabelsData;bindLooseLabelUi();renderLooseLabelItems();await refreshLabelsData();}

  async function refreshLabelsData(){try{showLoading(true,'Carregando pedidos a receber...');state.selectedWarehouseId=$('#labels-wh')?.value??state.selectedWarehouseId;const tasks=[loadReceiveOrders(state.selectedWarehouseId)];if(state.selectedWarehouseId){tasks.push(loadShortages(state.selectedWarehouseId));}else{tasks.push((async()=>{const lists=await Promise.all((state.warehouses||[]).map(w=>loadShortages(String(w.id||w.idStr||w.warehouseId||''))));state.shortages=lists.flat();})());}await Promise.all(tasks);renderLabelsOrders();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}

  function shortageMaps(){const bySkuId=new Map(),bySku=new Map();(state.shortages||[]).forEach(i=>{const q=num(i.shortage??i.shortageQty??i.outStockQty??i.qty??i.quantity??i.needQty,0);const ids=[i.skuId,i.warehouseSkuId,i.id,i.idStr].map(x=>String(x||'')).filter(Boolean);ids.forEach(id=>bySkuId.set(id,Math.max(num(bySkuId.get(id)),q)));const sku=normSku(i.sku||i.warehouseSku||i.varSku||i.skuCode);if(sku)bySku.set(sku,Math.max(num(bySku.get(sku)),q));});return{bySkuId,bySku};}

  function labelsRowsForOrder(o){const maps=shortageMaps();const selectedSize=state.labelsSize||'ALL';return(o.detailsVOList||[]).map(i=>{const remaining=Math.max(0,int(i.qty)-int(i.receivedQty)),shortage=Math.max(num(maps.bySkuId.get(String(i.skuId))),num(maps.bySku.get(normSku(i.sku)))),suggested=state.labelsOnlyShortage?Math.min(remaining,shortage):remaining;return{...i,remaining,shortage,suggested};}).filter(i=>wildcardMatches(`${o.commonNo} ${i.sku} ${i.skuTitle}`,state.labelsSearch)&&(!selectedSize||selectedSize==='ALL'||sizeFromSku(i.sku)===selectedSize)&&(!state.labelsOnlyShortage||i.shortage>0)&&i.remaining>0&&i.suggested>0).sort((a,b)=>skuCompare(a.sku,b.sku));}

  function renderLabelsOrders(){const groups=state.receiveOrders.map(order=>({order,rows:labelsRowsForOrder(order)})).filter(g=>g.rows.length),totalRows=groups.reduce((s,g)=>s+g.rows.length,0),totalLabels=groups.reduce((s,g)=>s+g.rows.reduce((x,r)=>x+r.suggested,0),0);$('#labels-stats').innerHTML=`<div class="kz-stats"><div class="kz-stat"><span>Pedidos pendentes</span><strong>${groups.length}</strong></div><div class="kz-stat"><span>SKUs pendentes</span><strong>${totalRows}</strong></div><div class="kz-stat"><span>Etiquetas sugeridas</span><strong>${totalLabels}</strong></div><div class="kz-stat"><span>Parciais</span><strong>${groups.filter(g=>g.order.status==='partial_received').length}</strong></div></div>`;if(!groups.length){$('#labels-orders').innerHTML='<div class="kz-empty">Nenhuma etiqueta pendente para os filtros atuais.</div>';return;}$('#labels-orders').innerHTML=groups.map(({order,rows})=>`<section class="kz-card" data-receive-order="${esc(order.id)}"><div class="kz-card-head"><div><h3>${esc(order.commonNo)}</h3><span class="kz-muted">${esc(order.warehouseName)} · ${order.status==='partial_received'?'Recebimento parcial':'A receber'}</span></div><span class="kz-badge ${order.status==='partial_received'?'yellow':'blue'}">${order.status==='partial_received'?'Parcial':'A receber'}</span></div><div class="kz-card-body">${rows.map(r=>{const pct=r.qty>0?Math.min(100,Math.round((num(r.receivedQty)/num(r.qty))*100)):0,max=Math.max(0,int(r.remaining)),value=Math.min(max,Math.max(1,int(r.suggested)));return`<div class="kz-receive-row" data-detail-id="${esc(r.id)}" data-sku-id="${esc(r.skuId)}">${r.skuImage?`<img src="${esc(r.skuImage)}">`:'<span></span>'}<div><b>${esc(r.sku)}</b><div class="kz-muted">${esc(r.skuTitle)}</div><div class="kz-progress" style="margin-top:6px"><span style="width:${pct}%"></span></div></div><div class="center"><b>${int(r.receivedQty)}/${int(r.qty)}</b><div class="kz-muted">recebido</div></div><div class="center"><b>${max}</b><div class="kz-muted">pendente</div></div><div class="center">${r.shortage>0?`<span class="kz-badge red">${int(r.shortage)} esgotado</span>`:'-'}</div><div class="kz-label-actions"><input type="number" min="1" max="${max}" class="kz-qty label-qty" value="${value}"><button class="kz-btn primary small" data-print-label>Imprimir</button></div></div>`;}).join('')}</div></section>`).join('');$$('.label-qty').forEach(inp=>inp.oninput=()=>{const max=int(inp.max);let v=int(inp.value);if(v>max){inp.value=max;toast(`Máximo pendente: ${max}.`,'error');}else if(v<1)inp.value=1;});$$('[data-print-label]').forEach(b=>b.onclick=async()=>{const sec=b.closest('[data-receive-order]'),row=b.closest('[data-detail-id]'),order=state.receiveOrders.find(o=>String(o.id)===String(sec.dataset.receiveOrder)),item=(order.detailsVOList||[]).find(i=>String(i.id)===String(row.dataset.detailId)),remaining=Math.max(0,int(item.qty)-int(item.receivedQty));let qty=int($('.label-qty',row).value);if(qty<1)return toast('Informe uma quantidade maior que zero.','error');if(qty>remaining){$('.label-qty',row).value=remaining;return toast(`Não pode imprimir mais do que falta. Máximo pendente: ${remaining}.`,'error');}await printAndReceiveLabel(order,item,qty);});}

  // /api/full-inventory/list não aceita busca por SKU (confirmado via captura de
  // rede) — só pagina a lista inteira de produtos elegíveis ao Full. Por isso
  // busca tudo uma vez (nos dois status que já vimos ter vínculo válido:
  // all_full e recommended_to_full — um produto pode ter desativado o Full mas
  // ainda ter o SKU vinculado num desses dois) e monta um mapa por itemSku pra
  // consulta instantânea na hora de imprimir.
  async function fetchFullInventoryMap(force=false){
    if(state.fullInventoryMap&&!force)return state.fullInventoryMap;
    const statuses=['all_full','recommended_to_full'];
    const rows=(await Promise.all(statuses.map(fullStatus=>pagedPost('/api/full-inventory/list',(pageNum,pageSize)=>({sortName:'1',sortValue:'1',pageNum,pageSize,fullStatus}),d=>d?.list||[],d=>d?.total||0)))).flat();
    const map=new Map();
    rows.forEach(r=>{const sku=normSku(r.itemSku);if(!sku)return;if(!map.has(sku))map.set(sku,[]);map.get(sku).push(r);});
    state.fullInventoryMap=map;
    return map;
  }

  function chooseFullInventoryItem(candidates){
    return new Promise(resolve=>{
      const b=document.createElement('div');
      b.className='kz-modal-backdrop';
      b.innerHTML=`<div class="kz-modal kz-modal-small"><div class="kz-modal-head"><h3>Qual produto do Full?</h3><button class="kz-icon-btn" data-action="cancel">×</button></div><div class="kz-modal-body"><div class="kz-search-results" style="position:static;max-height:320px">${candidates.map((c,idx)=>`<div class="kz-search-item" data-idx="${idx}">${c.mainImage?`<img src="${esc(c.mainImage)}">`:'<span class="kz-noimg"></span>'}<div><b>${esc(c.inventoryId)}</b><span>${esc(c.title)}</span></div></div>`).join('')}</div></div><div class="kz-modal-foot"><button class="kz-btn secondary" data-action="cancel">Cancelar</button></div></div>`;
      b.addEventListener('click',e=>{
        const item=e.target.closest('[data-idx]');
        if(item){b.remove();resolve(candidates[Number(item.dataset.idx)]);return;}
        if(e.target?.dataset?.action==='cancel'){b.remove();resolve(null);}
      });
      document.body.appendChild(b);
    });
  }

  async function printAndReceiveLabel(order,item,qty){const remainingLocal=Math.max(0,int(item.qty)-int(item.receivedQty));if(qty>remainingLocal)return toast(`Não pode imprimir mais do que falta. Máximo pendente: ${remainingLocal}.`,'error');let fullMatch=null;if(state.fullLabelMode){const map=await fetchFullInventoryMap();const matches=map.get(normSku(item.sku))||[];if(matches.length===1)fullMatch=matches[0];else if(matches.length>1){fullMatch=await chooseFullInventoryItem(matches);if(!fullMatch)return;}}const itemSize=sizeFromSku(item.sku);const itemAlias=itemSize==='OUTRO'?await fetchSkuAlias(item.sku):'';const printItem=fullMatch?{sku:item.sku,title:fullMatch.title,image:item.skuImage,qty,size:/chic\s*seek/i.test(order.warehouseName||'')?labelSize(item.sku,itemAlias):'',full:{inventoryId:fullMatch.inventoryId}}:{sku:item.sku,title:item.skuTitle,image:item.skuImage,qty,size:labelSize(item.sku,itemAlias)};buildLabelPrintWindow([printItem],false);const ok=await confirmBox({title:'Confirmar impressão',html:`<p>As <strong>${qty}</strong> etiqueta(s) do SKU <strong>${esc(item.sku)}</strong> saíram corretamente?</p><p>Ao confirmar, o UpSeller receberá parcialmente essa mesma quantidade.</p>`,confirmText:'Sim, impressão correta'});if(!ok)return;try{showLoading(true,'Registrando recebimento parcial...');const detail=await getReceiveOrder(order.id),current=(detail.detailsVOList||[]).find(r=>String(r.skuId)===String(item.skuId));if(!current)throw new Error('O SKU não foi localizado no recebimento atualizado.');const remaining=Math.max(0,int(current.qty)-int(current.receivedQty));if(qty>remaining)throw new Error(`Quantidade restante atual: ${remaining}.`);await receivePartial(detail.id,[{id:Number(current.id),isNewShelfNumber:Number(current.isNewShelfNumber||0),purchaseQty:int(current.qty),receivedQty:int(current.receivedQty),toBePurchaseQty:qty,shelfNumber:current.shelfNumber||null,skuId:Number(current.skuId)}]);toast(`${qty} unidade(s) recebida(s) para ${item.sku}.`);await refreshLabelsData();}catch(e){console.error(e);toast(e.message,'error');}finally{showLoading(false);}}

  function bindLooseLabelUi(){let timer;$('#loose-label-search').oninput=e=>{clearTimeout(timer);const v=e.target.value.trim();state.looseLabelSearch=v;if(v.length<1)return $('#loose-label-results').innerHTML='';timer=setTimeout(()=>searchLooseLabelSku(v),250);};$('#loose-print').onclick=printLooseLabels;$('#loose-clear').onclick=()=>{state.looseLabelItems=[];renderLooseLabelItems();};$('#loose-apply-bulk').onclick=()=>{const q=Math.max(1,int($('#loose-bulk-qty').value));if(!q)return;state.looseLabelItems.forEach(i=>i.qty=q);renderLooseLabelItems();};}

  async function ensureLabelInventory(force=false){const wh=String($('#labels-wh')?.value||state.selectedWarehouseId||'');if(!wh)throw new Error('Selecione um armazém para pesquisar etiqueta avulsa.');if(!force&&state.labelInventoryWarehouseId===wh&&state.labelInventory.length)return;showLoading(true,'Carregando lista de estoque do armazém...');try{state.labelInventory=await loadInventoryForWarehouse(wh);state.labelInventoryWarehouseId=wh;}finally{showLoading(false);}}

  async function searchLooseLabelSku(value){try{await ensureLabelInventory(false);const results=[...(state.labelInventory||[])].filter(i=>wildcardMatches(`${i.sku} ${i.skuTitle||i.title||i.titleAlias||i.productName||''}`,value)).slice(0,40);state.looseLabelResults=results;$('#loose-label-results').innerHTML=`<div class="kz-search-results">${results.map(i=>{const id=i.idStr||i.id||i.skuId;return`<div class="kz-search-item" data-loose-id="${esc(id)}">${(i.imgUrl||i.skuImage)?`<img src="${esc(i.imgUrl||i.skuImage)}">`:''}<div><b>${esc(i.sku)}</b><span>${esc(i.skuTitle||i.title||i.titleAlias||i.productName||i.sku)}</span></div></div>`;}).join('')||'<div class="kz-search-item">Nenhum produto encontrado.</div>'}</div>`;$$('[data-loose-id]').forEach(el=>el.onclick=()=>{const i=state.looseLabelResults.find(x=>String(x.idStr||x.id||x.skuId)===String(el.dataset.looseId));if(i)addLooseLabelItem(i,Math.max(1,int($('#loose-label-qty').value)));});}catch(e){console.error(e);$('#loose-label-results').innerHTML='';toast(e.message,'error');}}

  function addLooseLabelItem(s,qty=1){const id=String(s.idStr||s.id||s.skuId||s.sku);const ex=state.looseLabelItems.find(i=>String(i.id)===id||normSku(i.sku)===normSku(s.sku));if(ex)ex.qty+=qty;else state.looseLabelItems.push({id,sku:s.sku,title:s.skuTitle||s.title||s.titleAlias||s.productName||s.sku,image:s.imgUrl||s.skuImage||'',qty});$('#loose-label-search').value='';$('#loose-label-results').innerHTML='';renderLooseLabelItems();}

  function renderLooseLabelItems(){const box=$('#loose-label-items');if(!box)return;if(!state.looseLabelItems.length){box.innerHTML='<div class="kz-muted">Nenhum item avulso adicionado.</div>';return;}box.innerHTML=state.looseLabelItems.map((i,idx)=>`<div class="kz-loose-row" data-loose-idx="${idx}"><div><b>${esc(i.sku)}</b><span>${esc(i.title)}</span></div><input type="number" min="1" value="${int(i.qty)||1}" class="loose-item-qty"><button title="Remover">×</button></div>`).join('');$$('[data-loose-idx]',box).forEach(row=>{const idx=int(row.dataset.looseIdx);$('.loose-item-qty',row).onchange=e=>{state.looseLabelItems[idx].qty=Math.max(1,int(e.target.value));renderLooseLabelItems();};$('button',row).onclick=()=>{state.looseLabelItems.splice(idx,1);renderLooseLabelItems();};});}

  async function printLooseLabels(){const base=state.looseLabelItems.filter(i=>int(i.qty)>0);if(!base.length)return toast('Adicione pelo menos um produto avulso.','error');const items=await Promise.all(base.map(async i=>{const size=sizeFromSku(i.sku);const alias=size==='OUTRO'?await fetchSkuAlias(i.sku):'';return{sku:i.sku,title:i.title,image:i.image,qty:int(i.qty),size:labelSize(i.sku,alias)};}));buildLabelPrintWindow(items,false);toast(`${items.reduce((s,i)=>s+int(i.qty),0)} etiqueta(s) avulsa(s) enviada(s) para impressão.`);}


  function buildPurchasePdf(order){const items=[...(order.detailsVOList||[])].sort((a,b)=>skuCompare(a.sku,b.sku)),total=items.reduce((s,i)=>s+int(i.qty),0),no=order.commonNo||order.idStr||order.id,company=order.warehouseName||'Chic Seek',rows=items.map(i=>`<tr><td class="photo">${i.skuImage?`<img src="${esc(i.skuImage)}">`:''}</td><td class="sku">${esc(i.sku)}</td><td>${esc(i.skuTitle)}</td><td class="center">${esc(sizeFromSku(i.sku))}</td><td class="qty">${int(i.qty)}</td></tr>`).join(''),html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(no)}</title><style>*{box-sizing:border-box}body{font-family:Arial;margin:0;color:#20242a}.page{padding:18px 22px}.header{display:flex;justify-content:space-between;border-bottom:1px solid #aeb7c2;padding-bottom:12px}.brand{font-size:20px;font-weight:700}.title{font-size:17px;font-weight:700;margin-top:4px}.po{font-size:13px;font-weight:700;margin-top:3px}.date{font-size:11px;color:#4b5563}.summary{display:flex;gap:26px;font-size:11px;padding:11px 0}.supplier{font-size:11px;margin-bottom:10px}.section{font-size:11px;font-weight:700;margin:6px 0}.category{font-size:11px;background:#f3f4f6;border-radius:5px;padding:7px 9px;margin-bottom:10px}table{width:100%;border-collapse:collapse}th{font-size:10px;color:#4b5563;text-align:left;padding:6px;border-bottom:1px solid #aeb7c2}td{font-size:10px;padding:6px;border-bottom:1px solid #e1e5e9}.photo{width:56px;text-align:center}.photo img{width:42px;height:42px;object-fit:contain}.sku{width:95px;font-weight:700}.center{text-align:center}.qty{width:82px;text-align:center;font-size:12px;font-weight:700}.total{text-align:right;margin-top:10px;font-size:11px;font-weight:700}@page{size:A4;margin:10mm}@media print{.page{padding:0}}</style></head><body><div class="page"><div class="header"><div><div class="brand">${esc(company)}</div><div class="title">Pedido de Reposição</div><div class="po">${esc(no)}</div></div><div class="date">Data: ${esc(formatDate(order.createTime))}</div></div><div class="summary"><span>Total de itens: <strong>${items.length}</strong></span><span>Total de peças: <strong>${total}</strong></span></div><div class="supplier"><strong>Fornecedor:</strong> ${esc(order.supplierName||'-')}</div><div class="section">Resumo por categoria:</div><div class="category">${total} - Tradicionais</div><table><thead><tr><th>Imagem</th><th>SKU</th><th>Produto</th><th class="center">Tamanho</th><th class="center">Quantidade</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total de peças: ${total}</div></div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;const w=window.open('','_blank');if(!w)return toast('O navegador bloqueou o PDF.','error');w.document.open();w.document.write(html);w.document.close();}
  function buildLabelPrintWindow(items,isReprint=false){const two=state.paper==='50x25',pageWidth=two?'100mm':'60mm',pageHeight=two?'25mm':'40mm',labelWidth=two?'50mm':'60mm',qr=sku=>`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sku)}`,barcode=value=>`https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(value)}&code=Code128&dpi=200&showhrt=false`;let labels='';for(const item of items.sort((a,b)=>skuCompare(a.sku,b.sku))){for(let i=0;i<int(item.qty);i++){if(item.full){labels+=`<article class="label full-label">${isReprint?'<div class="watermark">RE-IMPRESSA</div>':''}<div class="full-size">${esc(item.size||sizeFromSku(item.sku))}</div><img class="full-barcode" src="${barcode(item.full.inventoryId)}"><div class="full-id">${esc(item.full.inventoryId)}</div><div class="full-title">${esc(item.title)}</div><div class="full-sku-line">SKU: ${esc(item.sku)}</div></article>`;}else{labels+=`<article class="label">${isReprint?'<div class="watermark">RE-IMPRESSA</div>':''}<img src="${qr(item.sku)}"><div class="info"><div class="sku">${esc(item.sku)} <span>— ${esc(item.size||sizeFromSku(item.sku))}</span></div><div class="title">${esc(cleanTitle(item.title,item.sku))}</div></div></article>`;}}}const html=`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:${pageWidth};font-family:Arial}.sheet{display:grid;grid-template-columns:${two?'repeat(2,50mm)':'60mm'};width:${pageWidth}}.label{position:relative;width:${labelWidth};height:${pageHeight};display:flex;align-items:center;gap:2mm;padding:1.4mm;overflow:hidden;page-break-inside:avoid}.label img{width:${two?'20mm':'28mm'};height:${two?'20mm':'28mm'};object-fit:contain}.info{flex:1;min-width:0}.sku{font-weight:900;font-size:${two?'10pt':'14pt'};line-height:1.05}.title{font-weight:700;font-size:${two?'7.5pt':'10pt'};line-height:1.12;margin-top:1mm;word-break:break-word}.watermark{position:absolute;inset:0;display:grid;place-items:center;font-size:17pt;font-weight:900;color:rgba(0,0,0,.08);transform:rotate(-18deg)}.label.full-label{flex-direction:column;align-items:stretch;justify-content:center;gap:0;padding:1mm 1.5mm}.full-label .full-barcode{width:97%;height:${two?'9mm':'14mm'};object-fit:contain;align-self:center}.full-label .full-id{font-weight:900;font-size:${two?'8pt':'11pt'};text-align:center;letter-spacing:.3px;margin-top:.3mm}.full-label .full-title{font-weight:700;font-size:${two?'6.5pt':'9pt'};line-height:1.05;text-align:center;word-break:break-word;margin-top:.3mm}.full-label .full-sku-line{font-weight:700;font-size:${two?'6.5pt':'9pt'};text-align:left;padding-left:1.5mm;margin-top:.4mm}.full-label .full-size{position:absolute;top:.8mm;right:1.2mm;font-size:${two?'13pt':'18pt'};font-weight:900;line-height:1}@page{size:${pageWidth} ${pageHeight};margin:0}</style></head><body><main class="sheet">${labels}</main><script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`;const w=window.open('','_blank');if(!w)return toast('O navegador bloqueou a impressão.','error');w.document.open();w.document.write(html);w.document.close();}

  if(FULLSCREEN_MODE)mountFullscreen();else{const start=()=>document.body?bootLauncher():setTimeout(start,30);start();}
}

try {
  initComprasModule();
} catch (e) {
  console.warn('[Kryzer Agent] erro ao iniciar módulo initComprasModule:', e);
}
