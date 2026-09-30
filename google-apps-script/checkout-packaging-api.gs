/**
 * Kryzer Checkout - Embalagens e Operações
 * Google Apps Script Web App
 *
 * Implantação:
 * 1. Abra a planilha "Kryzer Checkout - Embalagens e Operações".
 * 2. Extensões > Apps Script.
 * 3. Cole este arquivo em Code.gs.
 * 4. Em Configurações do projeto > Propriedades do script, crie:
 *      API_TOKEN = uma chave longa/aleatória
 * 5. Implantar > Nova implantação > Aplicativo da Web.
 *      Executar como: Eu
 *      Quem tem acesso: Qualquer pessoa
 * 6. Copie a URL /exec. O token fica somente no navegador/Tampermonkey.
 */

const SPREADSHEET_ID = '1Je79NTOUZEEwC7FE9P5bapuuZme76vwM_E7jDg-a8dI';
const SHEETS = {
  OPERATIONS: 'OPERACOES',
  PACKAGING: 'EMBALAGENS',
  SKU_MAP: 'MAPEAMENTO_SKU',
  ACCOUNTS: 'CONTAS',
};

function doGet(e) {
  try {
    auth_(e);
    const action = String((e && e.parameter && e.parameter.action) || 'bootstrap');
    if (action === 'bootstrap') return json_(bootstrap_());
    if (action === 'health') return json_({ ok: true, now: new Date().toISOString() });
    return json_({ ok: false, error: 'Ação GET inválida.' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const payload = parseBody_(e);
    auth_(e, payload);
    const action = String(payload.action || '');

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      if (action === 'logOperation') return json_(logOperation_(payload));
      if (action === 'upsertSkuMapping') return json_(upsertSkuMapping_(payload));
      if (action === 'health') return json_({ ok: true, now: new Date().toISOString() });
      return json_({ ok: false, error: 'Ação POST inválida.' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function auth_(e, payload) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw new Error('API_TOKEN não configurado nas Propriedades do Script.');

  const fromQuery = e && e.parameter ? String(e.parameter.token || '') : '';
  const fromBody = payload ? String(payload.token || '') : '';
  if ((fromBody || fromQuery) !== expected) throw new Error('Token inválido.');
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (_) { throw new Error('JSON inválido.'); }
}

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Aba não encontrada: ' + name);
  return sheet;
}

function bootstrap_() {
  const packages = readPackaging_();
  const skuMappings = readSkuMappings_();
  const accounts = readAccounts_();
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    packaging: packages,
    skuMappings,
    accounts,
  };
}

function readPackaging_() {
  const s = sheet_(SHEETS.PACKAGING);
  const last = s.getLastRow();
  if (last < 2) return [];
  const rows = s.getRange(2, 1, last - 1, 12).getValues();
  return rows
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      id: String(r[0] || '').trim(),
      name: String(r[1] || '').trim(),
      packagingSku: String(r[2] || '').trim(),
      cost: number_(r[3]),
      weightG: number_(r[4]),
      lengthCm: number_(r[5]),
      widthCm: number_(r[6]),
      heightCm: number_(r[7]),
      active: r[8] !== false,
      notes: String(r[11] || '').trim(),
    }))
    .filter(x => x.active);
}

function readSkuMappings_() {
  const s = sheet_(SHEETS.SKU_MAP);
  const last = s.getLastRow();
  if (last < 2) return [];
  const rows = s.getRange(2, 1, last - 1, 10).getValues();
  return rows
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      sku: String(r[0] || '').trim(),
      title: String(r[1] || '').trim(),
      packagingId: String(r[2] || '').trim(),
      packagingName: String(r[3] || '').trim(),
      firstSeenAt: iso_(r[4]),
      lastSeenAt: iso_(r[5]),
      ordersCount: number_(r[6]),
      lastPuid: String(r[7] || '').trim(),
      accountsSeen: String(r[8] || '').trim(),
      notes: String(r[9] || '').trim(),
    }));
}

function readAccounts_() {
  const s = sheet_(SHEETS.ACCOUNTS);
  const last = s.getLastRow();
  if (last < 2) return [];
  const rows = s.getRange(2, 1, last - 1, 8).getValues();
  return rows
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      puid: String(r[0] || '').trim(),
      account: String(r[1] || '').trim(),
      clientCnpj: String(r[2] || '').trim(),
      operationValue: number_(r[3]),
      active: r[4] !== false,
      firstSeenAt: iso_(r[5]),
      lastSeenAt: iso_(r[6]),
      notes: String(r[7] || '').trim(),
    }));
}

function logOperation_(p) {
  const orderId = clean_(p.orderId);
  const puid = clean_(p.puid);
  if (!orderId) throw new Error('orderId obrigatório.');
  if (!puid) throw new Error('puid obrigatório.');

  const idem = clean_(p.idempotencyKey) || [puid, orderId, 'ORIGINAL'].join('|');
  const opSheet = sheet_(SHEETS.OPERATIONS);

  if (findExactRow_(opSheet, 26, idem)) {
    return { ok: true, duplicate: true, idempotencyKey: idem };
  }

  const packaging = findPackaging_(clean_(p.packagingId));
  if (!packaging) throw new Error('Embalagem não encontrada/ativa: ' + clean_(p.packagingId));

  const account = upsertAccount_(puid, clean_(p.account), clean_(p.clientCnpj));
  const skus = normalizeSkus_(p.skus);
  skus.forEach(item => upsertSkuSeen_(item, puid, clean_(p.account)));

  const operationValue = p.operationValue != null
    ? number_(p.operationValue)
    : number_(account.operationValue);

  const now = new Date();
  const packagingCost = number_(packaging.cost);
  const total = packagingCost + operationValue;

  opSheet.appendRow([
    clean_(p.eventId) || Utilities.getUuid(),
    now,
    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    puid,
    clean_(p.account),
    clean_(p.marketplace),
    orderId,
    clean_(p.orderNo),
    clean_(p.orderType),
    skus.map(x => x.qty > 1 ? (x.sku + ' x' + x.qty) : x.sku).join(' | '),
    skus.reduce((sum, x) => sum + number_(x.qty || 1), 0),
    packaging.id,
    packaging.name,
    packaging.packagingSku,
    packagingCost,
    packaging.weightG,
    packaging.lengthCm,
    packaging.widthCm,
    packaging.heightCm,
    clean_(p.selectionOrigin) || 'MANUAL',
    operationValue,
    total,
    clean_(p.checkoutVersion),
    'OK',
    clean_(p.notes),
    idem,
  ]);

  return {
    ok: true,
    duplicate: false,
    idempotencyKey: idem,
    packagingCost,
    operationValue,
    total,
  };
}

function upsertSkuMapping_(p) {
  const sku = clean_(p.sku);
  const packagingId = clean_(p.packagingId);
  if (!sku) throw new Error('sku obrigatório.');
  if (!packagingId) throw new Error('packagingId obrigatório.');

  const packaging = findPackaging_(packagingId);
  if (!packaging) throw new Error('Embalagem não encontrada/ativa.');

  const s = sheet_(SHEETS.SKU_MAP);
  const row = findExactRow_(s, 1, sku);
  const now = new Date();

  if (row) {
    s.getRange(row, 2, 1, 9).setValues([[
      clean_(p.title) || s.getRange(row, 2).getValue(),
      packaging.id,
      packaging.name,
      s.getRange(row, 5).getValue() || now,
      now,
      number_(s.getRange(row, 7).getValue()),
      clean_(p.puid),
      mergeList_(s.getRange(row, 9).getValue(), clean_(p.account)),
      clean_(p.notes) || s.getRange(row, 10).getValue(),
    ]]);
  } else {
    s.appendRow([
      sku,
      clean_(p.title),
      packaging.id,
      packaging.name,
      now,
      now,
      0,
      clean_(p.puid),
      clean_(p.account),
      clean_(p.notes),
    ]);
  }

  return { ok: true, sku, packagingId: packaging.id, packagingName: packaging.name };
}

function upsertAccount_(puid, accountName, clientCnpj) {
  const s = sheet_(SHEETS.ACCOUNTS);
  const row = findExactRow_(s, 1, puid);
  const now = new Date();

  if (row) {
    if (accountName) s.getRange(row, 2).setValue(accountName);
    if (clientCnpj) s.getRange(row, 3).setValue(clientCnpj);
    if (!s.getRange(row, 5).getValue()) s.getRange(row, 5).setValue(true);
    if (!s.getRange(row, 6).getValue()) s.getRange(row, 6).setValue(now);
    s.getRange(row, 7).setValue(now);
  } else {
    s.appendRow([puid, accountName, clientCnpj, 0, true, now, now, '']);
  }

  const targetRow = row || s.getLastRow();
  return {
    puid,
    operationValue: number_(s.getRange(targetRow, 4).getValue()),
  };
}

function upsertSkuSeen_(item, puid, accountName) {
  const sku = clean_(item.sku);
  if (!sku) return;

  const s = sheet_(SHEETS.SKU_MAP);
  const row = findExactRow_(s, 1, sku);
  const now = new Date();

  if (row) {
    if (item.title) s.getRange(row, 2).setValue(clean_(item.title));
    if (!s.getRange(row, 5).getValue()) s.getRange(row, 5).setValue(now);
    s.getRange(row, 6).setValue(now);
    s.getRange(row, 7).setValue(number_(s.getRange(row, 7).getValue()) + 1);
    s.getRange(row, 8).setValue(puid);
    s.getRange(row, 9).setValue(mergeList_(s.getRange(row, 9).getValue(), accountName));
  } else {
    s.appendRow([
      sku,
      clean_(item.title),
      '',
      '',
      now,
      now,
      1,
      puid,
      accountName,
      '',
    ]);
  }
}

function findPackaging_(id) {
  if (!id) return null;
  return readPackaging_().find(x => x.id === id) || null;
}

function findExactRow_(sheet, col, value) {
  if (!value || sheet.getLastRow() < 2) return 0;
  const finder = sheet.getRange(2, col, Math.max(1, sheet.getLastRow() - 1), 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .findNext();
  return finder ? finder.getRow() : 0;
}

function normalizeSkus_(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(x => typeof x === 'string'
      ? { sku: clean_(x), title: '', qty: 1 }
      : { sku: clean_(x && x.sku), title: clean_(x && x.title), qty: Math.max(1, number_(x && x.qty) || 1) })
    .filter(x => x.sku);
}

function mergeList_(current, next) {
  const set = new Set(
    String(current || '').split('|').map(x => x.trim()).filter(Boolean)
  );
  if (clean_(next)) set.add(clean_(next));
  return Array.from(set).join(' | ');
}

function number_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const normalized = String(v == null ? '' : v).replace(/\./g, '').replace(',', '.').trim();
  const n = Number(normalized);
  return isFinite(n) ? n : 0;
}

function clean_(v) {
  return String(v == null ? '' : v).trim();
}

function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v.toISOString();
  return clean_(v);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
