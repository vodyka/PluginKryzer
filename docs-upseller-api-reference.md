# UPSELLER API REFERENCE — CONSOLIDADA

**Versão:** julho/2026  
**Conta de referência:** NEXTO / Chic Seek  
**PUID conhecido:** `30945`  
**Base URL:** `https://app.upseller.com`

> Documento focado exclusivamente em dados, endpoints, payloads, respostas, regras e fluxos internos do UpSeller.
> Não inclui Trilha, Google Sheets, Tampermonkey, Puppeteer ou arquitetura externa.

## Regras obrigatórias

1. Não inventar endpoints.
2. Toda requisição autenticada deve usar `credentials: "include"`.
3. A autenticação é por cookie de sessão do navegador; não há Bearer Token público.
4. Em APIs de pedido, usar sempre `idStr` interno, nunca `orderNumber`.
5. Para kits, usar `groupVOS[].varSku` como SKU físico.
6. Em `/api/order/index`, o campo do armazém é `warehouseIdStr`.
7. Em `/api/order/detail`, o campo do armazém é `warehouseId`.
8. Processos assíncronos devem consultar `/api/check-process?uuid=...` até conclusão.
9. `code === 0` representa sucesso nas respostas comuns. Em `processMsg`, `code` tem semântica própria: `0` processando, `1` concluído e `-1` falhou.
10. Ao descobrir endpoint novo, registrar método, URL, content type, payload real, resposta e observações.

---

# UPSELLER API REFERENCE
# Mapeamento completo de endpoints internos — atualizar sempre que descobrir novo
# Base URL: https://app.upseller.com
# Auth: cookie de sessão (JSESSIONID + us_u) — sem token externo
# Todas as respostas retornam: { code: 0, msg: "success", data: ... }
# code != 0 indica erro — checar campo msg
# Versão do campo: "version": "6.9.1" (header informativo, não obrigatório)
# ─────────────────────────────────────────────────────────────────────────────


# ══════════════════════════════════════════════════════════════
# 1. AUTENTICAÇÃO
# ══════════════════════════════════════════════════════════════

# Login via API: NÃO EXISTE
# POST /api/user/login → 404 Not Found
# Upseller exige login via browser. Usar cookie de sessão capturado.

# PUID do usuário logado (necessário para o plugin de impressão WebSocket)
GET /api/home
# Resposta relevante:
# { data: { user: { puid: 30945, id: 30945 } } }


# ══════════════════════════════════════════════════════════════
# 2. PEDIDOS — LISTAGEM E FILTROS
# ══════════════════════════════════════════════════════════════

# Lista pedidos com filtros (mesma API de todas as abas de Pedidos)
POST /api/order/index
Content-Type: application/x-www-form-urlencoded

# Parâmetros:
# timeType=0          → por tempo de criação
# searchType=0        → busca geral
# searchValue=        → texto de busca
# sortName=1          → ordenar por prazo (7=mais urgente primeiro)
# sortValue=0         → 0=ASC, 1=DESC
# orderState=in_process  → Processando Pedidos
# orderState=allocate    → Para Reservar (inclui Sem Estoque)
# isVoided=0          → não cancelado
# labelStatus=success    → etiqueta gerada com sucesso
# labelStatus=fail       → etiqueta com falha
# pageNum=1
# pageSize=300        → máximo testado sem problemas
# warehouseType=0
# printCount=0        → etiqueta não impressa (0=não impressa, omitir=todas)

# Resposta:
# data: { total, list, pageNum, pageSize, pages }
# Cada item da list contém:
#   idStr           → ID interno do pedido (usar em todas as outras APIs)
#   authIdStr       → ID de autenticação (necessário para mark-print e print-label)
#   orderNumber     → ex: "UPY71185610"
#   platform        → "shopee" | "mercado" | "shein" | "tiktok" | "kwai"
#   shopName        → nome da loja
#   warehouseIdStr  → ID do armazém (ATENÇÃO: não "warehouseId" — "warehouseIdStr")
#   warehouseName
#   orderState
#   allocateStatus  → "out_stock" se sem estoque
#   errorMsg        → JSON stringificado com detalhes do erro (ex: SKU em falta)
#   orderItemList[] → itens resumidos (SKU comercial, não físico do armazém)
#   deadlineAt / logisticsDeadlineAt → prazo de envio (campo varia por plataforma)

# Contagem por estado (para as abas do painel)
POST /api/order/all-state-count
Content-Type: application/json
Body: {}

# Contagem de etiquetas impressas/não impressas
POST /api/order/process-print-state-count
Content-Type: application/json
Body: { "orderState": "in_process", "isVoided": 0 }
# Resposta: { allProcess, printed, unPrinted, canceled }

# Contagem de estados de processamento
POST /api/order/process-state-count
Content-Type: application/json
Body: {}
# Resposta: { creatingLabel, labelPrintable, labelFailed, shipping, shipFail, pushing, pushed, pushFail }


# ══════════════════════════════════════════════════════════════
# 3. PEDIDOS — DETALHE
# ══════════════════════════════════════════════════════════════

# Detalhe completo de 1 pedido
GET /api/order/detail?id={idStr}
# Resposta: { data: { order: { ... campos completos ... } } }
# Usar para confirmar: orderState, allocateStatus, warehouseId, errorMsg

# Detalhe dos itens REAIS do pedido (SKUs físicos do armazém, incluindo kits)
POST /api/sku-order/detail
Content-Type: application/json
Body: { "orderId": "{idStr}", "platform": "shopee" }
# ATENÇÃO: orderId = idStr interno, não o orderNumber
# platform deve bater com o platform do pedido
# Resposta: array com itens reais
#   isGroup=1 → pedido kit → ver groupVOS[].varSku para SKU físico real
#   groupVOS[].varSku   → SKU físico (usar este, não groupVOS[].sku)
#   groupVOS[].num      → quantidade
#   goodsCount          → quantidade do item (usar quando isGroup=0)
# ATENÇÃO: groupVOS[].sku = SKU comercial do kit (NÃO usar para separação)
#          groupVOS[].varSku = SKU físico do armazém (usar este)


# ══════════════════════════════════════════════════════════════
# 4. PEDIDOS — SEPARAÇÃO / PICK LIST
# ══════════════════════════════════════════════════════════════

# Carrega a picklist pelo número
POST /api/pick/scan-pick-list
Content-Type: application/json
Body: { "pickListNo": "PL2606240012" }
# Resposta: { data: { pickListVoList: [ ... ] } }
# Cada PL contém:
#   pickListNo, wareHouseName, picker, orderCount, skuCount, itemCount, printDate
#   pickListVoList[] → itens com: sku, title, itemQty, image, barcode, variantValue, uniqueKey

# Escaneia SKU dentro de uma PL (busca pedido pelo SKU)
POST /api/pick/scan-sorting-order
Content-Type: application/json
Body: {
  "pickListNo": "PL2606240012",
  "checkLaterList": [],
  "ignoreList": [],
  "queryType": 0,
  "queryCode": "504GB04"
}
# Resposta: { data: { orderId, idStr, trackingNumber, orderItemList[] } }
# Retorna o pedido que contém aquele SKU na PL
# ERRO "Order.Scan_Ship.Not_belong_to_the_current_picking_scope"
#   → SKU não pertence a esta PL ou pedido já foi processado

# Lista pedidos de uma PL
POST /api/pick/scan-sorting-list
Content-Type: application/json
Body: { "pickListNo": "PL2606240012" }

# Verifica/processa impressão (check-print = confirma que pedido foi finalizado)
GET /api/order/check-print?id={idStr}


# ══════════════════════════════════════════════════════════════
# 5. ETIQUETAS DE ENVIO
# ══════════════════════════════════════════════════════════════

# Passo 1: Prepara o job de etiqueta
POST /api/order/get-print-label-order
Content-Type: application/x-www-form-urlencoded
Body: orderIdList%5B0%5D={idStr}
# Também aceita múltiplos: orderIdList%5B0%5D=ID1&orderIdList%5B1%5D=ID2
# Resposta: { code:0, data:[] }  ← vazio, só prepara

# Passo 2: Solicita geração da etiqueta
POST /api/print-label
Content-Type: application/x-www-form-urlencoded
Body: isCos=1&printIdStr={idStr}&authIdStr={authIdStr}&isBatchPrint=1
# authIdStr vem do campo authIdStr do pedido (order/index ou order/detail)
# Resposta: { data: "ORDER_MANAGE:PRINT_LABEL:XXXX:30945" }  ← UUID do job

# Passo 3: Poll até PDF ficar pronto (repetir até code=1)
GET /api/check-process?uuid=ORDER_MANAGE%3APRINT_LABEL%3AXXXX%3A30945
# Resposta quando processando: { data: { processMsg: { code: 0, num: 0 } } }
# Resposta quando pronto:
#   { data: { processMsg: {
#       code: 1,
#       msg: "https://print-label.upseller.cn/pdf/2026-06-24/abc123.pdf",
#       data: { successList: [{id, code, msg}], failList: [] }
#   } } }
# code=-1 → falhou

# Passo 4: Marca pedido como impresso
POST /api/order/mark-print
Content-Type: application/x-www-form-urlencoded
Body: isBatch=0&mark=1&markType=0&orderIdList%5B0%5D={idStr}
# mark=1 → marcar como impresso
# mark=0 → desmarcar
# Resposta: { code:0, msg:"success" }

# Plugin de impressão alta velocidade (WebSocket)
# ws://localhost:21319  ← plugin instalado no PC do usuário
# Mensagem getPrinter:   { method: "getPrinter", params: null }
# Mensagem setPuid:      { method: "setPuid", params: [puid] }
# Mensagem changePrinter: { method: "changePrinter", params: ["Nome Impressora"] }
# Mensagem printMany:   { method: "printMany", params: [["idStr1","idStr2"]] }
# Resposta printProcess: { method:"printProcess", data:{ printSuccess:[{orderIdStr, trackingNo}], printError:[] } }


# ══════════════════════════════════════════════════════════════
# 6. PEDIDOS SEM ESTOQUE
# ══════════════════════════════════════════════════════════════

# Lista produtos esgotados (tela "Para Reservar → Sem Estoque")
POST /api/sku-order/out-stock-order
Content-Type: application/json
Body: { "pageNum": 1, "pageSize": 300, "sortName": "2", "sortValue": "0" }
# Filtrar por armazém:
Body: { "warehouseId": "2126524341394363", "searchType": 1, "searchValue": "", "pageNum": 1, "pageSize": 300, "sortName": "2", "sortValue": "0" }
# Resposta: { data: { pageInfo: { list: [...] }, warehouseList: [...], totalSku, totalShortage } }
# Cada item:
#   skuId, sku, title, warehouseId, warehouseName
#   available=0       → zerado
#   orderRequirements → quantidade total pedida
#   shortage          → quantidade em falta
# msg="No_out_of_stock" → nenhum produto sem estoque (não é erro)


# ══════════════════════════════════════════════════════════════
# 7. ESTOQUE / INVENTÁRIO
# ══════════════════════════════════════════════════════════════

# Contagem de SKUs por armazém (para descobrir warehouseIds cadastrados)
POST /api/warehouse-sku/count
Content-Type: application/json
Body: { "searchType": "1", "isGroup": 0 }
# Resposta: array de { warehouseId, warehouseName, cou (contagem de SKUs), isDefault }

# Lista de SKUs de um armazém (com paginação)
POST /api/warehouse-sku/list
Content-Type: application/json
Body: {
  "warehouseId": "2126524341394363",
  "sortName": "0",
  "sortValue": "0",
  "pageNum": 1,
  "pageSize": 200
}
# Filtros opcionais: skuOrTitle, catalogId, saleStatus, isLowStock, isGroup
# Resposta: { data: { total, list, pageNum, pageSize, pages } }
# Cada item:
#   id, idStr, skuId        → IDs internos
#   sku, skuTitle           → código e nome
#   imgUrl                  → URL da imagem
#   onhand                  → estoque total (incluindo alocado)
#   allocated               → alocado em pedidos pendentes
#   available               → disponível real (onhand - allocated)
#   lowStockValue           → estoque mínimo configurado
#   maxStock                → estoque máximo configurado
#   isLowStock              → 0/1
#   costPrice, totalCostPrice
#   warehouseId, warehouseName
#   createTime, updateTime
#   shelfNumber             → localização na prateleira

# Custo total do armazém
POST /api/warehouse-sku/warehouse-total-cost
Content-Type: application/json
Body: { "warehouseId": "2126524341394363", "sortName": "0", "sortValue": "0", "pageNum": 1, "pageSize": 50 }
# Resposta: { data: { totalOnhands, totalCostPrice } }

# Buscar SKU por código (para obter skuId interno)
GET /api/sku/scan-sku?searchType=1&searchValue={SKU}&sourceType=2&warehouseId={warehouseId}
# searchType=1 → busca por SKU exato
# sourceType=2 → busca no armazém específico
# Resposta: lista de itens com skuId, onhand, available

# Contagem de inventário (ajuste de estoque físico)
POST /api/inventory-count/save
Content-Type: application/json
Body: {
  "warehouseId": "{warehouseId}",
  "note": "Ajuste manual",
  "details": [
    {
      "skuId": "{skuId}",
      "qty": 0,              ← atual (scan)
      "counted": 10,         ← contado real
      "skuImage": "...",
      "skuTitle": "...",
      "note": "Observação"
    }
  ],
  "heads": "SKU±Qtd. Real±Observação",
  "translationKey": "{...}"
}


# ══════════════════════════════════════════════════════════════
# 8. TRANSFERÊNCIAS ENTRE ARMAZÉNS
# ══════════════════════════════════════════════════════════════

# Criar transferência
POST /api/transfer/add-transfer
Content-Type: application/json
Body: {
  "originWarehouseId": "2374395364956369",   ← armazém de ORIGEM
  "warehouseId":       "2374395369669783",   ← armazém de DESTINO
  "expectedTime": null,
  "note": "Transferência automática pedido UP11PR039347",
  "trackingNo": "AUTO-UP11PR039347",
  "currency": "BRL",
  "shippingCost": "",
  "otherFee": "",
  "operateType": 1,
  "details": [
    {
      "skuId": "2374395365107002",   ← ID interno do SKU (vem de warehouse-sku/list)
      "qty": "1",
      "unitPrice": null,
      "isNewShelfNumber": null
    }
  ]
}
# Resposta: { code:0, msg:"success", data: 2 }  ← data não é o TR
# Após criar: aguardar 1.5-3s e consultar transfer/list pelo trackingNo

# Listar transferências
POST /api/transfer/list
Content-Type: application/json
Body: { "pageNum": 1, "pageSize": 50 }
# Filtros: originWarehouseId, warehouseId, status, trackingNo
# Resposta: lista com commonNo (ex: TR10023), status, itens

# Contagem de transferências (painel/diagnóstico)
POST /api/transfer/count
Content-Type: application/json
Body: {}
# Resposta: { canceled, toShip, total, partialReceived, completed, inTransit }


# ══════════════════════════════════════════════════════════════
# 9. PEDIDOS DE COMPRA (REPOSIÇÃO)
# ══════════════════════════════════════════════════════════════

# Criar pedido de compra
POST /api/procure/add-procure
Content-Type: application/json
Body: {
  "warehouseId": "2126524341394363",
  "supplierName": "HIUP TEMATICOS",
  "supplierId": 198,
  "trackingNo": "",
  "expectedTime": null,
  "note": "",
  "inboundType": 0,
  "currency": "BRL",
  "discountCost": "",
  "shippingCost": "",
  "otherFee": "",
  "operateType": 0,
  "details": [
    {
      "skuId": "2126524341396324",   ← ID interno do SKU
      "qty": 5,
      "costPrice": 14.5,
      "sku": "504GB02"               ← código legível (redundante, mas incluir)
    }
  ]
}
# Resposta: { code:0, msg:"success", data: 3 }  ← data = ID do PC criado
# ATENÇÃO: skuId é obrigatório — buscar via warehouse-sku/list


# ══════════════════════════════════════════════════════════════
# 10. PRODUTOS / SKUs
# ══════════════════════════════════════════════════════════════

# Criar produto (SKU simples)
POST /api/sku/save-single
Content-Type: application/json
Body: {
  "sku": "504GB04",
  "title": "Ciganinha G. Bailarina M",
  "brand": "",
  "barcode": "7898765432100",
  "costPrice": 14.50,
  "description": "",
  "imgUrl": "https://image-product.upseller.cn/sku-img/...",
  "isInvoice": 0,
  "referencePrice": "",
  "releaseDate": "2026-07-13 00:00:00",
  "salesStatus": "0",
  "taxGroupId": -1,
  "taxOrigin": 0,
  "taxUnit": "UN",
  "currency": "BRL",
  "priceUnit": "R$",
  "titleAlias": "",
  "sizeChart": "",
  "salesmanId": "",
  "supplierLink": "",
  "supplierLinkList": [{ "value": "" }],
  "skuAliasList": ["CODIGO-FORNECEDOR"],
  "skuRelations": [],
  "skuSupplierRelations": [],
  "wareHouseSkus": [
    { "wareHouseId": "2126524341394363", "count": "" }
  ]
}

# Upload de imagem (fluxo em 2 passos)
# Passo 1: Gerar URL assinada
POST /api/media/file/upload/generate-sign
Content-Type: application/json
Body: {
  "module": "product",
  "spaceCode": "SkuImage",
  "fileName": "produto.jpg",
  "suffix": ".jpg"
}
# Resposta: { data: { sign: "https://...", url: "https://image-product.upseller.cn/...", fileKey, bucket } }

# Passo 2: Upload direto para a URL assinada
PUT {sign}
Body: (bytes do arquivo)
# Sem autenticação — URL pública temporária
# Após upload, usar response.data.url como imgUrl no save-single


# ══════════════════════════════════════════════════════════════
# 11. ESTATÍSTICAS / FINANCEIRO
# ══════════════════════════════════════════════════════════════

# Faturamento por loja (últimos N dias)
POST /api/statistics/shop-sale-all-data
Content-Type: application/json
Body: { "beginDate": "2026-06-13", "endDate": "2026-07-13" }
# Resposta: { data: { amount: 45230.50, ... } }

# Lista de vendas detalhada
POST /api/statistics/shop-sale-all-list
Content-Type: application/json
Body: { "beginDate": "2026-06-13", "endDate": "2026-07-13", "pageNum": 1, "pageSize": 50 }


# ══════════════════════════════════════════════════════════════
# 12. INFORMAÇÕES GERAIS
# ══════════════════════════════════════════════════════════════

# Verificar status de processo assíncrono (genérico para qualquer job)
GET /api/check-process?uuid={uuid}
# Usado para: geração de etiqueta, sincronização de estoque, etc.
# uuid vem na resposta da operação que iniciou o processo

# Sincronização automática de estoque (Configurações)
# → Não é uma API direta. O Upseller tem uma tela de configuração que
#   dispara um botão "Salvar" e depois "Sincronizar Agora".
#   Automatizar via script visual (Puppeteer) navegando em:
#   /pt/settings/inventory?warehouseId=
#   Ver script: UpSeller - Sincronização Automática de Estoque V4

# Lista de armazéns disponíveis na conta
# → Usar POST /api/warehouse-sku/count (retorna warehouseId de todos)
# → Ou POST /api/warehouse-sku/list (primeiro item tem warehouseName)

# IDs de armazéns conhecidos (conta NEXTO / Chic Seek):
# 2126524210485235 → Vektor (SCO)        — 160 SKUs
# 2126524341394363 → Chic Seek (SCO)     — 469 SKUs
# 2126524341426723 → (verificar)         — 107 SKUs
# 2126524358565934 → (verificar)         — 679 SKUs
# 2126524361468962 → (verificar)         —  54 SKUs
# puid da conta: 30945


# ══════════════════════════════════════════════════════════════
# 13. PADRÕES E CONVENÇÕES
# ══════════════════════════════════════════════════════════════

# Autenticação:
#   credentials: 'include'  ← em todos os fetch (usa cookie de sessão)
#   Sem Bearer Token, sem Authorization header

# Headers padrão:
#   application/json → Content-Type: application/json
#   form data        → Content-Type: application/x-www-form-urlencoded

# Respostas de erro:
#   { code: -1, msg: "mensagem de erro", data: null }
#   msg pode ser chave i18n: "Order.Scan_Ship.Not_belong_to_the_current_picking_scope"

# IDs internos:
#   idStr / wareHouseId / warehouseIdStr → string numérica de 16 dígitos
#   Nunca assumir que "warehouseId" e "warehouseIdStr" são o mesmo campo
#   Em order/index: usar "warehouseIdStr" (não "warehouseId")
#   Em order/detail: usar "warehouseId"

# Kits:
#   isGroup=1 em sku-order/detail → item é kit
#   groupVOS[].varSku → SKU físico real para separação
#   groupVOS[].sku    → SKU comercial do kit (não usar para separação)

# Processo assíncrono padrão (etiqueta, sync, etc):
#   1. Chamar endpoint de início → retorna uuid
#   2. Poll GET /api/check-process?uuid=... a cada 600ms
#   3. code=0 no processMsg → processando
#   4. code=1 no processMsg → concluído (msg contém resultado)
#   5. code=-1 no processMsg → falhou

# URLs de imagem:
#   Produtos: https://image-product.upseller.cn/sku-img/{puid}/...
#   Etiquetas: https://print-label.upseller.cn/pdf/{data}/{hash}.pdf



# 14. FLUXOS VALIDADOS

## 14.1 Descobrir o usuário e PUID

```http
GET /api/home
```

Usar o valor:

```text
data.user.puid
```

O PUID é necessário em integrações internas que vinculam processos ao usuário logado, como o plugin local de impressão.

## 14.2 Descobrir armazéns da conta

```http
POST /api/warehouse-sku/count
Content-Type: application/json
```

```json
{
  "searchType": "1",
  "isGroup": 0
}
```

A resposta fornece `warehouseId`, `warehouseName`, quantidade de SKUs e indicação do armazém padrão.

Não gravar um `warehouseId` apenas pelo nome sem antes confirmar na conta atual, porque IDs mudam entre contas.

## 14.3 Obter o SKU interno antes de alterar estoque

Há duas formas validadas:

### Busca direta

```http
GET /api/sku/scan-sku?searchType=1&searchValue={SKU}&sourceType=2&warehouseId={warehouseId}
```

### Listagem paginada

```http
POST /api/warehouse-sku/list
Content-Type: application/json
```

```json
{
  "warehouseId": "2126524341394363",
  "sortName": "0",
  "sortValue": "0",
  "pageNum": 1,
  "pageSize": 200
}
```

O campo necessário para inventário, transferência e pedido de compra é o `skuId` interno.

## 14.4 Ajustar estoque por contagem

```http
POST /api/inventory-count/save
Content-Type: application/json
```

```json
{
  "warehouseId": "2126524341394363",
  "note": "Ajuste automático",
  "details": [
    {
      "skuId": "2126524341396324",
      "qty": 8,
      "counted": 10,
      "skuImage": "https://image-product.upseller.cn/sku-img/...",
      "skuTitle": "Produto de exemplo",
      "note": "Correção de saldo"
    }
  ],
  "heads": "SKU±Qtd. Real±Observação",
  "translationKey": "{}"
}
```

Regras operacionais:

- `qty` representa o saldo atual conhecido no UpSeller.
- `counted` representa o saldo físico final desejado.
- Não criar contagem quando `qty === counted`.
- Enviar somente SKUs divergentes.
- O endpoint aceita múltiplos itens em `details`; o limite exato do servidor ainda não foi documentado oficialmente.

## 14.5 Criar produto simples

```http
POST /api/sku/save-single
Content-Type: application/json
```

Campos confirmados:

- `sku`
- `title`
- `brand`
- `barcode`
- `costPrice`
- `description`
- `imgUrl`
- `referencePrice`
- `releaseDate`
- `salesStatus`
- `taxGroupId`
- `taxOrigin`
- `taxUnit`
- `currency`
- `priceUnit`
- `titleAlias`
- `skuAliasList`
- `wareHouseSkus`

Observações:

- `skuAliasList` pode receber o código do fabricante.
- `wareHouseSkus` define em quais armazéns o SKU será criado.
- Para iniciar sem saldo, usar `count: ""` ou o valor aceito pela interface capturada.
- A criação de produto com variações/grupos ainda não está mapeada.

## 14.6 Upload de imagem de produto

### Gerar URL assinada

```http
POST /api/media/file/upload/generate-sign
Content-Type: application/json
```

```json
{
  "module": "product",
  "spaceCode": "SkuImage",
  "fileName": "produto.jpg",
  "suffix": ".jpg"
}
```

### Enviar o arquivo

```http
PUT {sign}
```

Enviar os bytes do arquivo diretamente para a URL temporária.

Depois do upload, usar `data.url` retornada na geração da assinatura como `imgUrl` do `/api/sku/save-single`.

Não foi documentado neste arquivo um endpoint separado obrigatório de callback. Caso a interface atual passe a dispará-lo, ele deve ser capturado novamente no Network antes de ser incluído.

## 14.7 Criar transferência

```http
POST /api/transfer/add-transfer
Content-Type: application/json
```

Campos fundamentais:

- `originWarehouseId`: origem
- `warehouseId`: destino
- `details[].skuId`: SKU interno
- `details[].qty`: quantidade

A resposta `data` não deve ser tratada automaticamente como o número `TR...`. Para localizar a transferência criada, consultar `/api/transfer/list` usando `trackingNo` ou outros dados únicos.

## 14.8 Criar pedido de compra

```http
POST /api/procure/add-procure
Content-Type: application/json
```

Requer:

- `warehouseId`
- `supplierId`
- `supplierName`
- `details[].skuId`
- `details[].qty`
- `details[].costPrice`
- `details[].sku`

O endpoint para listar fornecedores e obter `supplierId` ainda não foi mapeado.

## 14.9 Obter itens físicos de um pedido

```http
POST /api/sku-order/detail
Content-Type: application/json
```

```json
{
  "orderId": "ID_INTERNO_IDSTR",
  "platform": "shopee"
}
```

Para item comum:

```text
goodsCount
```

Para kit:

```text
groupVOS[].varSku
groupVOS[].num
```

Nunca usar `groupVOS[].sku` para separar o componente físico do kit.

## 14.10 Gerar etiqueta de envio

Fluxo validado:

1. `/api/order/get-print-label-order`
2. `/api/print-label`
3. `/api/check-process?uuid=...`
4. `/api/order/mark-print`

Intervalo recomendado de polling: entre 600 e 700 ms.

Finalizar somente quando:

```text
processMsg.code === 1
```

Falha:

```text
processMsg.code === -1
```

---

# 15. CAMPOS E IDENTIFICADORES IMPORTANTES

| Campo | Uso |
|---|---|
| `idStr` | ID interno do pedido usado pelas APIs |
| `orderNumber` | Número visível do pedido; não substituir `idStr` |
| `authIdStr` | Necessário no fluxo de impressão de etiqueta |
| `warehouseIdStr` | Campo de armazém em `/api/order/index` |
| `warehouseId` | Campo de armazém em `/api/order/detail` e APIs de estoque |
| `skuId` | ID interno do SKU para estoque, transferência e compra |
| `sku` | Código legível/comercial do SKU |
| `varSku` | SKU físico de componente de kit |
| `puid` | Identificador do usuário logado |
| `uuid` | Identificador de processo assíncrono |

---

# 16. ENDPOINTS CONFIRMADOS — ÍNDICE RÁPIDO

## Usuário

- `GET /api/home`

## Pedidos

- `POST /api/order/index`
- `POST /api/order/all-state-count`
- `POST /api/order/process-print-state-count`
- `POST /api/order/process-state-count`
- `GET /api/order/detail`
- `POST /api/sku-order/detail`
- `GET /api/order/check-print`

## Separação

- `POST /api/pick/scan-pick-list`
- `POST /api/pick/scan-sorting-order`
- `POST /api/pick/scan-sorting-list`

## Etiquetas

- `POST /api/order/get-print-label-order`
- `POST /api/print-label`
- `GET /api/check-process`
- `POST /api/order/mark-print`

## Sem estoque

- `POST /api/sku-order/out-stock-order`

## Estoque e inventário

- `POST /api/warehouse-sku/count`
- `POST /api/warehouse-sku/list`
- `POST /api/warehouse-sku/warehouse-total-cost`
- `GET /api/sku/scan-sku`
- `POST /api/inventory-count/save`

## Transferências

- `POST /api/transfer/add-transfer`
- `POST /api/transfer/list`
- `POST /api/transfer/count`

## Compras

- `POST /api/procure/add-procure`

## Produtos

- `POST /api/sku/save-single`
- `POST /api/media/file/upload/generate-sign`
- `PUT {sign}`

## Estatísticas

- `POST /api/statistics/shop-sale-all-data`
- `POST /api/statistics/shop-sale-all-list`

---

# 17. ENDPOINTS AINDA NÃO MAPEADOS

Os seguintes recursos não devem ser implementados por suposição:

- receber mercadoria de pedido de compra;
- listar pedidos de compra existentes;
- listar fornecedores cadastrados;
- listar lojas conectadas;
- editar produto simples;
- excluir produto;
- criar ou editar produto com variações;
- histórico de movimentação de estoque por SKU;
- criar pedido de separação programaticamente;
- listar categorias e grupos fiscais;
- editar preço de produto já criado;
- consultar logs internos de sincronização;
- webhooks internos.

## Procedimento para descobrir

1. Abrir o DevTools.
2. Acessar a aba `Network`.
3. Filtrar por `Fetch/XHR`.
4. Executar manualmente a ação desejada na interface.
5. Registrar:
   - método;
   - URL;
   - query string;
   - headers relevantes;
   - content type;
   - request payload;
   - response;
   - sequência de chamadas;
   - eventual `uuid` e polling.
6. Repetir com dados diferentes para identificar campos obrigatórios.
7. Só depois adicionar o endpoint a este documento.

---

# 18. LIMITAÇÕES E CUIDADOS

- Os endpoints são internos e podem mudar sem aviso.
- A sessão pode expirar e retornar HTML de login em vez de JSON.
- Sempre validar `Content-Type` antes de interpretar a resposta.
- Não zerar estoque quando houver timeout, falha de sessão ou resposta inválida.
- IDs de armazém e SKUs não são portáveis entre contas.
- Um mesmo nome de armazém pode ter IDs diferentes em contas diferentes.
- Paginar listas até `pageNum >= pages`.
- Não assumir que `data` possui o mesmo significado em endpoints diferentes.
- Não confundir saldo `onhand`, `allocated` e `available`.
- Para sincronização física, definir claramente se a origem deve representar `onhand` ou `available`.
- Antes de ações destrutivas ou financeiras, confirmar o payload com uma captura real recente.

---

# 19. MODELO PARA REGISTRAR NOVO ENDPOINT

```markdown
## Nome do recurso

### Endpoint

`METHOD /api/...`

### Content-Type

`application/json`

### Request

```json
{}
```

### Response

```json
{}
```

### Campos importantes

- `campo`: descrição

### Fluxo

1. ...
2. ...

### Validação

- Data da captura:
- Conta:
- Tela do UpSeller:
- Resultado testado:
```
