// Módulo "random": varre pedidos Sem Estoque (allocateStatus=out_stock) cuja
// variação seja Aleatório/Sortido/Variado (produtos sem SKU fixo, o vendedor decide
// a combinação na hora da separação) e troca automaticamente pelo produto real de
// estoque mais parado (Curva C, maior "dias em estoque"), restrito à mesma SPU do
// item original — pra nunca esvaziar Curva A nem pegar item sazonal (ex.: Junino)
// só porque está parado fora de época. Roda sozinho, sem tela — toda troca deixa
// uma nota no pedido via /api/order-comment/comment pra dar rastreabilidade, já
// que aqui não existe um passo de aprovação manual (decisão explícita do usuário).
// Todo endpoint usado abaixo foi confirmado por captura de rede real, nunca chutado.
// Limitação conhecida: itens isGroup:1 (kit agregado) são pulados por enquanto —
// ainda não temos uma captura real mostrando qual critério de SPU faz sentido pra
// cada componente do kit, então preferimos não aplicar do que aplicar errado.

function initRandomModule() {
  console.log('[Kryzer Agent] módulo random iniciado.');

  const SCAN_INTERVAL_MS = 10 * 60 * 1000;
  const FIRST_SCAN_DELAY_MS = 8000;
  const SKIP_RETRY_MS = 60 * 60 * 1000;
  const STAGNANT_SALE_COUNT_MAX = '5';
  const STAGNANT_TIME_TYPE = '2';
  const STORAGE_LOG = 'kz_random_log_v1';
  const STORAGE_SKIP = 'kz_random_skip_v1';

  const RANDOM_ATTR_RE = /^(aleatori[oa]|sortid[oa]|variad[oa])$/;

  let scanning = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage indisponível — não é crítico, só perde o histórico local.
    }
  }

  function isSuccess(json) {
    return !!json && json.code === 0;
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

  function normalizeAttr(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }

  function isRandomAttr(productAttr) {
    return String(productAttr || '')
      .split(',')
      .some(part => RANDOM_ATTR_RE.test(normalizeAttr(part)));
  }

  // POST /api/order/index, form-encoded — mesmo padrão usado pelo próprio UpSeller
  // pra listar "Sem Estoque" em massa (allocateStatus=out_stock).
  async function fetchOutOfStockOrders() {
    const body = new URLSearchParams({
      timeType: '0',
      searchType: '0',
      searchValue: '',
      sortName: '1',
      sortValue: '0',
      orderState: 'allocate',
      isVoided: '0',
      allocateStatus: 'out_stock',
      pageNum: '1',
      pageSize: '300',
    });
    const { json } = await postForm('/api/order/index', body);
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao listar pedidos sem estoque.');
    return Array.isArray(json?.data?.list) ? json.data.list : [];
  }

  // POST /api/sku-order/detail, JSON — composição real do pedido (orderItemId,
  // isGroup, goodsCount etc.), a mesma usada pelo módulo checkout no Alt+Click.
  async function fetchRelationDetail(order) {
    const { json } = await postJson('/api/sku-order/detail', {
      orderId: order.idStr,
      platform: order.platform || '',
    });
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao consultar composição do pedido.');
    return Array.isArray(json?.data) ? json.data : [];
  }

  // POST /api/warehouse-sale/index, JSON, type:"3" = aba "Produtos Encalhados".
  // warehouseIds restringe ao armazém do próprio pedido (senão sugeriria produto
  // sem estoque físico ali). Busca generoso (pageSize alto) e filtra/ordena aqui
  // mesmo, em vez de confiar no sortName/sortValue do servidor.
  async function fetchStagnantCandidates(warehouseId, spu) {
    const { json } = await postJson('/api/warehouse-sale/index', {
      type: '3',
      searchType: '0',
      searchValue: '',
      timeType: STAGNANT_TIME_TYPE,
      saleCount: STAGNANT_SALE_COUNT_MAX,
      warehouseIds: [warehouseId],
      pageNum: 1,
      pageSize: 200,
      sortName: '4',
      sortValue: '0',
    });
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao consultar produtos encalhados.');
    const list = Array.isArray(json?.data?.list) ? json.data.list : [];
    return list
      .filter(row => row.spu && String(row.spu) === String(spu) && Number(row.available || 0) > 0)
      .sort((a, b) => Number(b.days || 0) - Number(a.days || 0));
  }

  async function applyRelationChange(order, orderItemId, warehouseId, skuInfoList) {
    const { json } = await postJson('/api/sku-order/edit-relation', {
      orderItemId,
      warehouseId,
      orderId: order.idStr,
      platform: order.platform || '',
      skuInfoList,
    });
    return isSuccess(json);
  }

  async function addOrderComment(orderId, content) {
    const body = new URLSearchParams({ content, id: orderId });
    const { json } = await postForm('/api/order-comment/comment', body);
    if (!isSuccess(json)) throw new Error(json?.msg || 'Falha ao salvar nota no pedido.');
  }

  function logApplied(order, noteParts) {
    const log = readJson(STORAGE_LOG, []);
    log.unshift({ time: new Date().toISOString(), orderNo: order.orderNumber, orderId: order.idStr, changes: noteParts });
    writeJson(STORAGE_LOG, log.slice(0, 200));
    console.log(`[Kryzer Agent][random] pedido ${order.orderNumber} trocado automaticamente: ${noteParts.join('; ')}`);
  }

  async function processOrder(order, flaggedItems) {
    const relationItems = await fetchRelationDetail(order);
    const changes = [];
    const noteParts = [];

    for (const flagged of flaggedItems) {
      const relItem = relationItems.find(r => !r.isGroup && r.sku === flagged.variationSku);
      if (!relItem) {
        throw new Error(`item ${flagged.variationSku} não encontrado na composição real, ou é um kit (isGroup) — ainda não suportado.`);
      }

      const spu = flagged.productSku;
      if (!spu) throw new Error(`item ${flagged.variationSku} sem SPU identificável.`);

      const candidates = await fetchStagnantCandidates(order.warehouseIdStr, spu);
      if (!candidates.length) throw new Error(`nenhum candidato parado disponível pra SPU ${spu}.`);

      const needed = Number(relItem.goodsCount || flagged.productCount || 1);
      const picks = [];
      let remaining = needed;
      for (const candidate of candidates) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(candidate.available || 0));
        if (take <= 0) continue;
        picks.push({ skuId: candidate.skuId, count: take, sku: candidate.sku });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new Error(`estoque insuficiente entre os candidatos da SPU ${spu} pra cobrir ${needed}x.`);
      }

      changes.push({
        orderItemId: relItem.orderItemId,
        warehouseId: order.warehouseIdStr,
        skuInfoList: picks.map(p => ({ skuId: p.skuId, count: p.count })),
      });
      noteParts.push(`${flagged.variationSku} -> ${picks.map(p => `${p.count}x ${p.sku}`).join(' + ')}`);
    }

    for (const change of changes) {
      const ok = await applyRelationChange(order, change.orderItemId, change.warehouseId, change.skuInfoList);
      if (!ok) throw new Error('a troca (edit-relation) falhou.');
    }

    try {
      await addOrderComment(order.idStr, `[Kryzer Random] Troca automática: ${noteParts.join('; ')}`);
    } catch (error) {
      console.warn(`[Kryzer Agent][random] pedido ${order.orderNumber} trocado, mas a nota não foi salva:`, error.message || error);
    }

    logApplied(order, noteParts);
  }

  async function runScan() {
    if (scanning) return;
    scanning = true;
    try {
      let orders;
      try {
        orders = await fetchOutOfStockOrders();
      } catch (error) {
        console.warn('[Kryzer Agent][random] falha ao listar pedidos sem estoque:', error.message || error);
        return;
      }

      const skip = readJson(STORAGE_SKIP, {});
      const now = Date.now();
      let skipChanged = false;

      for (const order of orders) {
        const orderId = order.idStr || String(order.orderId);
        const skipEntry = skip[orderId];
        if (skipEntry && (now - skipEntry.time) < SKIP_RETRY_MS) continue;

        const flaggedItems = (order.orderItemList || []).filter(item => isRandomAttr(item.productAttr));
        if (!flaggedItems.length) continue;

        try {
          await processOrder(order, flaggedItems);
          if (skip[orderId]) { delete skip[orderId]; skipChanged = true; }
        } catch (error) {
          console.warn(`[Kryzer Agent][random] pedido ${order.orderNumber} não processado:`, error.message || error);
          skip[orderId] = { time: now, reason: String(error.message || error) };
          skipChanged = true;
        }
      }

      if (skipChanged) writeJson(STORAGE_SKIP, skip);
    } finally {
      scanning = false;
    }
  }

  setTimeout(runScan, FIRST_SCAN_DELAY_MS);
  setInterval(runScan, SCAN_INTERVAL_MS);
}

try {
  initRandomModule();
} catch (e) {
  console.warn('[Kryzer Agent] erro ao iniciar módulo initRandomModule:', e);
}
