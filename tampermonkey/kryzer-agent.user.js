// ==UserScript==
// @name         Kryzer Agent
// @namespace    kryzer-agent
// @version      2.18.0
// @description  Agente único do UpSeller: liga direto os módulos de checkout, compras e alerta de venda — sem depender de nenhum backend externo pra decidir isso.
// @match        https://app.upseller.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      iqpxkxixoirdkkcgbejz.supabase.co
// @connect      upseller.cn
// @connect      image-product-upload.upseller.cn
// @connect      image-product.upseller.cn
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/checkout.js?v=2.18.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/checkout-unificado.js?v=2.18.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/compras.js?v=2.18.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/alerta-venda.js?v=2.18.0
// @updateURL    https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/kryzer-agent.user.js
// @downloadURL  https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/kryzer-agent.user.js
// ==/UserScript==

// ATENÇÃO: este arquivo agora é só o LOADER — carrega cada módulo direto do
// GitHub via @require (src/modules/checkout.js, compras.js, alerta-venda.js).
// NÃO existe mais build.js/bundle local: editar o módulo certo em
// src/modules/, commitar e dar push — o Tampermonkey de quem já tem o script
// instalado busca sozinho a versão nova (automático periodicamente, ou na
// hora clicando em "Check for userscript updates" no painel dele).
//
// Cada módulo em src/modules/ é autocontido: termina com
// `try { initXModule(); } catch (e) { ... }` chamando a si mesmo assim que
// carrega — não depende mais deste arquivo pra ser iniciado.
//
// Ao editar um módulo, suba também o número (?v=2.18.0) nas linhas @require
// abaixo — o Tampermonkey pode não rebuscar um @require se a URL não mudar.
//
// v2.18.0 (2026-09-23): separa totalmente a UNIFICACAO da impressao.
// MASTER, Moto Cintra e Giro X publicam snapshots direto num relay Supabase.
// O checkout MASTER le as tres filas pela nuvem, sem depender do Kryzer Print.
//
// v2.17.3 (2026-09-23): tenta abrir o Kryzer Print automaticamente quando
// a ponte local não responde e adiciona botão de teste explícito da ponte.
//
// v2.17.2 (2026-09-23): torna a unificação resiliente sem depender do WebSocket.
// Cada PUID publica snapshot/heartbeat HTTP a cada 10s, atualiza a fila a cada
// 30s e tenta fetch local se GM_xmlhttpRequest falhar. A origem mostra transporte
// e idade da última atualização.
//
// v2.17.1 (2026-09-22): corrige filtro de origem que podia esconder todos
// os pedidos quando a origem selecionada estava zerada/offline e mostra
// diagnóstico/versão da ponte local no cabeçalho.
//
// v2.17.0 (2026-09-22): adiciona fallback HTTP local na porta 21321 usando
// GM_xmlhttpRequest. Fontes podem sincronizar mesmo quando o WebSocket local
// falha em um perfil do Chrome. O painel de SKUs também passa a usar todos os
// pedidos recebidos e a classificação visual deriva a composição quando preciso.
//
// v2.16.2 (2026-09-22): corrige divergência entre contador das origens e
// lista central; o checkout passa a usar o mesmo snapshot para ambos. A ponte
// local tenta 127.0.0.1 e localhost e a tela da fonte ganhou reconexão manual.
//
// v2.16.1 (2026-09-22): adiciona seleção manual do armazém Master em CLIENTs
// quando o UpSeller devolve os armazéns sem nome. A escolha fica salva por PUID.
//
// v2.16.0 (2026-09-22): redesenha o Checkout Unificado como clone visual
// do checkout por produto já usado na operação: menu lateral, prioridade,
// marketplaces, abas de composição, leitura rápida e SKUs para separar.
//
// v2.15.0 (2026-09-22): liga a separação unificada de ponta a ponta.
// O MASTER envia ações por PUID para a conta de origem; após conferir todos
// os SKUs, a origem gera o PDF, o Kryzer Print imprime e só então a origem
// executa mark-print e atualiza a fila.
//
// v2.14.3 (2026-09-22): adiciona coletor de etiqueta diretamente no loader.
// Se houver ?kzCollectLabel=PEDIDO, o próprio loader localiza o pedido, gera
// o PDF via API e mostra a URL sem executar /api/order/mark-print.
//
// v2.14.2 (2026-09-22): corrige o coletor de etiqueta para iniciar isolado,
// antes do checkout unificado, do Kryzer Print e da sincronização das filas.
// A tela aparece imediatamente, valida PUID 34552 e só então busca o pedido.
//
// v2.14.1 (2026-09-22): adiciona coletor seguro de etiqueta por número do
// pedido via ?kzCollectLabel=PEDIDO. Localiza o pedido na sessão atual, chama
// get-print-label-order -> print-label -> check-process e exibe o PDF sem
// executar /api/order/mark-print.
//
// v2.14.0 (2026-09-22): adiciona leitura operacional ao Checkout Unificado.
// O campo de leitor foi separado da pesquisa. Ao bipar SKU/EAN + Enter, o
// sistema localiza o primeiro pedido elegível por prazo, inicia uma sessão de
// separação e cobra todas as unidades/SKUs do pedido antes de liberá-lo.
//
// v2.13.5 (2026-09-22): fixa o Master da Moto Cintra no warehouseId
// 2374395576103698 (confirmado pelos 2 pedidos corretos), torna a descoberta
// de armazéns recursiva e adiciona ?kzUnifiedSource=1 para diagnosticar/forçar
// a conexão de cada CLIENT ao MASTER.
//
// v2.13.4 (2026-09-22): corrige o filtro dos CLIENTs do Checkout Unificado.
// O UpSeller retorna warehouseIdStr numérico nos pedidos; agora cada CLIENT
// consulta /api/warehouse-sku/count, descobre qual warehouseId corresponde ao
// armazém chamado "Master" e filtra por ID real, não pelo texto do pedido.
//
// v2.13.3 (2026-09-22): torna o diagnóstico compatível também com o
// Kryzer Print 0.3.0 já instalado, enviando as informações pela própria
// sincronização de pedidos sem exigir reinstalação imediata do EXE.
//
// v2.13.2 (2026-09-22): adiciona diagnóstico por fonte no Checkout Unificado:
// total bruto da conta, total após filtro e quantidade por armazém. Isso permite
// identificar imediatamente por que um CLIENT conectado está enviando 0 pedidos.
//
// v2.13.1 (2026-09-22): corrige a tela unificada quando o Kryzer Print local
// está offline: o PUID MASTER 30945 agora carrega e exibe a própria fila
// diretamente, sem depender do broker. Também mostra diagnóstico explícito,
// botão para abrir o Kryzer Print e mantém Giro X/Moto Cintra como fontes
// dependentes da ponte local.
//
// v2.13.0 (2026-09-22): adiciona Checkout Unificado local. Somente os PUIDs
// 30945 (MASTER), 34552 (Moto Cintra) e 33745 (Giro X) participam. Nos dois
// CLIENTs, somente pedidos cujo armazém seja exatamente "Master" são enviados
// ao unificador. A tela exclusiva roda em ?kzUnifiedCheckout=1 no PUID 30945
// e consolida as três filas através do Kryzer Print local (porta 21320).
//
// v2.12.2 (2026-09-22): rollback do checkout.js para o estado do commit
// 9210b8dabdc808f25f379a7319c6d75038753bc2, imediatamente anterior à
// introdução do modo "Pedido Saída Manual [Full]" no checkout. O restante
// dos módulos do repositório permanece na versão atual.
//
// v2.12.1 (2026-08-27): checkout.js — corrige a busca por rastreio: só
// procurava localmente em state.orders (a lista de "etiqueta não impressa"),
// então um pedido já impresso nunca era encontrado — quebrando exatamente a
// segunda leitura (impresso -> Para Retirada), que só faz sentido pra pedido
// já impresso. Agora, se não achar localmente e o código parecer mesmo um
// rastreio (só dígitos, 8+), busca ao vivo em /api/order/index com
// searchType:4 (busca por rastreio, confirmado por captura de rede real).
// v2.12.0 (2026-08-26): checkout.js — bipar o CÓDIGO DE RASTREIO (em vez do
// SKU) no campo de leitura normal avança o status do pedido sem escanear
// produto: pedido "não impresso" -> marca como impresso (POST
// /api/order/mark-print, só o status, sem imprimir nada, confirmado com o
// usuário); pedido já "impresso" -> avança pra "Para Retirada" (POST
// /api/order/batch-to-pickup, confirmado por captura de rede real).
// v2.11.0 (2026-08-26): checkout.js — bipar um SKU do Full com mais de 1
// pendente agora pergunta a quantidade a imprimir (stepper igual o fluxo de
// impressão em massa de produto único do checkout de pedido), em vez de
// imprimir sempre só 1 por leitura. Se o SKU tiver 2+ anúncios vinculados no
// Full e a quantidade escolhida for maior que 1, também oferece dividir
// entre os anúncios — mesma lógica já usada no botão "Imprimir em massa".
// v2.10.2 (2026-08-26): checkout.js — corrige bug crítico: o popup de
// escolha (SKU com 2+ anúncios vinculados no Full) usava a classe
// "kzqc-modal-backdrop" (convenção do compras.js), mas o CSS deste arquivo
// estiliza o overlay pelo ID #kzqc-modal — o popup ficava sem estilo nenhum,
// invisível atrás do painel em tela cheia, travando a leitura sem erro
// nenhum. Corrige pra usar o padrão real (#kzqc-modal/.kzqc-modal-card).
// Também adiciona confirmação pós-impressão ("a etiqueta saiu corretamente?"
// — mesmo padrão do compras.js) antes de contar como impresso, tanto na
// bipagem unitária quanto na impressão em massa. E corrige o alinhamento da
// linha "SKU:" nas duas etiquetas (compras.js e checkout.js), que ficava
// centralizada apesar do text-align:left por causa do align-items:center
// herdado do container pai.
// v2.10.1 (2026-08-26): compras.js e checkout.js — ajustes na etiqueta do
// Full pedidos pelo usuário após ver a impressão real: código de barras
// volta pra altura da primeira versão (9mm/14mm — a versão mais alta estava
// saindo com o código de barras falhado/distorcido na impressão) e um pouco
// mais largo; nova linha "SKU: <sku do armazém>" abaixo do título, alinhada
// à esquerda com um respiro (diferente do resto, que é centralizado).
// v2.10.0 (2026-08-26): checkout.js — corrige e redesenha o modo Full:
// (1) bug crítico: o desvio pro modo Full rodava DEPOIS do resolveScanToSku
// do fluxo normal, que depende de pedidos que não existem nesse modo e
// travava a leitura em "Localizando..." pra sempre; agora o modo Full desvia
// antes de tudo isso. (2) Layout novo: lista de pedidos de saída Full à
// esquerda (seleciona um), produtos desse pedido pra bipar no centro — cada
// pedido é trabalhado por vez, sem ambiguidade de qual pedido um SKU bipado
// pertence. (3) A leitura agora também reconhece o código do próprio Full
// (inventoryId) bipado direto, além do SKU físico do armazém.
// v2.9.3 (2026-08-26): checkout.js — mesmos 3 ajustes do v2.9.2 aplicados na
// etiqueta do Full do modo "Pedido Saída Manual [Full]" (mesmo defeito, mesma
// API de barcode): &showhrt=false, código de barras maior, letra de tamanho
// só quando o armazém da saída manual é Chic Seek.
// v2.9.2 (2026-08-26): compras.js — 3 ajustes na etiqueta do Full: (1)
// desliga o texto legível embutido que o próprio TEC-IT desenha por baixo
// do código de barras (&showhrt=false, confirmado via teste real na API),
// que duplicava o inventoryId junto com o texto próprio da etiqueta — agora
// só o texto próprio (maior, estilizável) aparece; (2) código de barras um
// pouco maior; (3) a letra grande de tamanho só aparece quando o armazém do
// pedido de recebimento é Chic Seek.
// v2.9.1 (2026-08-26): checkout.js — corrige o layout do modo Full, que saía
// todo espremido numa coluna estreita e com o cabeçalho sobrepondo o botão
// "Origem". Causa: .kzqc-body é um grid de 3 colunas (sidebar + conteúdo +
// fila lateral) e a tela nova só tinha 1 filho, então o grid empurrava tudo
// pra dentro da primeira coluna (~250px). Adiciona classe própria pra forçar
// coluna única nesse modo.
// v2.9.0 (2026-08-26): checkout.js — novo modo "Origem: Pedido Saída Manual
// [Full]" (clique no chip "Origem" pra trocar). Lê saídas manuais de estoque
// (/api/warehouse-inout-list/out-list, status pendente) marcadas com "full"
// no note, em vez dos pedidos de etiqueta não impressa. Bipar um SKU imprime
// 1 etiqueta do Full (código de barras Code128 via TEC-IT do inventoryId,
// título do anúncio, tamanho grande); tem botão de imprimir em massa por
// linha do pedido. Progresso impresso fica salvo por ID da linha do pedido
// (sobrevive a editar quantidade; item removido do pedido continua mostrando
// quanto tinha sido impresso). SKU com 2+ anúncios vinculados no Full: no
// bipe unitário escolhe um; na impressão em massa também dá pra dividir a
// quantidade entre os anúncios.
// v2.8.0 (2026-08-26): compras.js — etiqueta do Full na aba Etiquetas. Novo
// toggle "Imprimir etiqueta do Full": ao imprimir um SKU com produto vinculado
// no Full (/api/full-inventory/list, status all_full + recommended_to_full,
// paginado e cacheado — o endpoint não filtra por SKU, então busca tudo e casa
// por itemSku no cliente), sai etiqueta com código de barras (Code128, via
// TEC-IT) do inventoryId do Full, o inventoryId como texto, o título do
// anúncio (não o do armazém) e o tamanho em letra grande. Sem vínculo, sai a
// etiqueta normal (QR) de sempre. Com 2+ vínculos pro mesmo SKU, abre um
// popup pra escolher qual.
// v2.7.1 (2026-08-26): checkout.js — corrige duplicação de quantidade em
// componente real de kit quando o SKU do anúncio (orderItemList[].productSku)
// coincide com o SKU de um dos componentes reais do kit. A exclusão do "item
// misto" agora casa por orderItemId (estável) em vez de comparar SKUs (o
// código interno do kit no groupVOS, ex. "KT87455", pode ser bem diferente
// do SKU configurado no anúncio pro mesmo item, ex. "14302"). Motivo real:
// pedido UPY71196938, componente 14302 x1 aparecia como x2.
// v2.7.0 (2026-08-26): alerta-venda.js — dois toggles novos no menu do
// Tampermonkey (ícone da extensão → seta ao lado de "Kryzer Agent"):
// "Popup de vendas" (card na tela + notificação nativa) e "Alerta sonoro de
// vendas", cada um liga/desliga independente. Precisou de @grant novo:
// GM_registerMenuCommand e GM_unregisterMenuCommand.
// v2.6.0 (2026-08-26): checkout.js — apito de sucesso no volume máximo
// possível (gain 3, acima de 1 = ganho real), agora mais alto que o próprio
// alarme de erro, a pedido do usuário. 3 camadas de tom em vez de 2 pra
// somar mais amplitude percebida.
// v2.5.0 (2026-08-26): checkout.js — remove o "corte operacional" por canal
// (getOperationalCutoff/orderPriorityAt: Mercado 14:15, Kwai/TikTok/Shein
// 16:40, Shopee Amarelé 14:30, Shopee geral 15:00) que fazia o painel
// mostrar um prazo de expiração mais cedo que o real da plataforma quando
// o pedido vencia no mesmo dia. A pedido do usuário — o painel agora
// mostra sempre o prazo oficial (orderTimeoutTimeStr), igual o nativo do
// UpSeller, em todos os canais.
// v2.4.0 (2026-08-26): checkout.js — apito de erro do scanner estava baixo
// demais pra ouvir no chão da operação (1 tom grave só). Agora são 3 apitos
// agudos em sequência no volume máximo, tipo alarme, junto com um flash
// vermelho piscando na tela inteira (#kzqc-error-flash) pra chamar atenção
// mesmo sem som.
// v2.3.0 (2026-08-26): checkout.js — ao clicar em atualizar pedidos (manual),
// aciona antes o /api/order/auto-refresh-stock nativo do UpSeller (re-tenta
// alocar estoque pros pedidos "Sem Estoque") e espera o job terminar via
// /api/check-process antes de buscar a lista atualizada. Só no clique manual
// — não roda nas atualizações automáticas depois de imprimir/marcar pedido.
// v2.2.0 (2026-08-26): remove por completo o módulo random (troca automática
// de produto Aleatório/Sortido/Variado por estoque parado). Ficou redundante
// desde que o UpSeller passou a resolver isso direto no cadastro do produto
// — o pedido já cai normal, sem precisar de swap depois.
// v2.1.1 (2026-08-26): corrige checkout.js — quando um kit (groupVOS) era
// comprado mais de uma vez no MESMO item de pedido (productCount > 1), a
// quantidade de cada componente não multiplicava por isso, só usava a
// quantidade de 1 kit. Pedido de 2x kit com 2 peças/kit mostrava 2 peças em
// vez de 4. Motivo real: pedido UPY71196758 (K02011 x2, kit de par -> devia
// pedir 16975 x4, mostrou só x2).
// v2.1.0 (2026-08-26): fim do bundle único (kryzer-agent.user.js gerado por
// build.js); volta ao esquema de um arquivo por módulo, cada um carregado
// direto do GitHub.
// v2.0.0 (2026-07-24): o projeto Supabase que hospedava o backend (checkin,
// papéis por computador, canva_sync) foi excluído sem chance de recuperação.
// Como esse computador é usado só pra uma operação (não é vendido/distribuído
// pra outros clientes), decidiu-se remover de vez a dependência de backend
// pros módulos do dia a dia — eles ligam direto, sem checar nada online
// primeiro. O módulo canva_sync foi descontinuado (removido do repositório);
// se algum dia for reativado, precisa de um backend próprio de novo.


console.log("[Kryzer Agent] script carregado em", location.href);

(async function kzDirectLabelCollector() {
  const params = new URLSearchParams(location.search);
  const targetOrderNo = String(params.get("kzCollectLabel") || "").trim().toUpperCase();
  if (!targetOrderNo) return;
  if (window.__KZ_DIRECT_LABEL_COLLECTOR__) return;
  window.__KZ_DIRECT_LABEL_COLLECTOR__ = true;

  const pageFetch = (typeof unsafeWindow !== "undefined" && unsafeWindow.fetch)
    ? unsafeWindow.fetch.bind(unsafeWindow)
    : fetch.bind(window);

  const norm = value => String(value == null ? "" : value).trim();
  const esc = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const waitBody = () => new Promise(resolve => {
    if (document.body) return resolve();
    const timer = setInterval(() => {
      if (!document.body) return;
      clearInterval(timer);
      resolve();
    }, 25);
  });

  let state = {
    kind: "loading",
    title: "Iniciando coletor...",
    message: "Preparando o teste seguro da etiqueta.",
    puid: "",
    order: null,
    url: ""
  };

  function render() {
    if (!document.body) return;
    let root = document.getElementById("kz-direct-label");
    if (!root) {
      root = document.createElement("div");
      root.id = "kz-direct-label";
      root.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#f5f6f8;overflow:auto;font-family:Arial,sans-serif;color:#172033";
      document.body.appendChild(root);
    }

    const bg = state.kind === "error" ? "#fef3f2" : state.kind === "success" ? "#ecfdf3" : "#f9fafb";
    const border = state.kind === "error" ? "#fecdca" : state.kind === "success" ? "#abefc6" : "#eaecf0";
    const order = state.order || {};

    root.innerHTML =
      '<div style="max-width:900px;margin:45px auto;padding:0 20px">' +
        '<div style="background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:24px;box-shadow:0 12px 30px rgba(16,24,40,.08)">' +
          '<div style="font-size:12px;font-weight:900;color:#667085;letter-spacing:.05em">KRYZER · COLETOR DIRETO DE ETIQUETA</div>' +
          '<h1 style="font-size:26px;margin:8px 0 4px">' + esc(targetOrderNo) + '</h1>' +
          '<div style="color:#667085;margin-bottom:18px">Não chama mark-print · não altera o status do pedido</div>' +
          '<div style="padding:14px;border-radius:10px;background:' + bg + ';border:1px solid ' + border + '">' +
            '<b>' + esc(state.title) + '</b>' +
            '<div style="margin-top:5px;color:#475467">' + esc(state.message) + '</div>' +
          '</div>' +
          (state.puid ? '<div style="margin-top:16px;font-size:13px;line-height:1.8"><b>PUID atual:</b> ' + esc(state.puid) +
            (order.idStr ? '<br><b>idStr:</b> ' + esc(order.idStr) : '') +
            (order.authIdStr ? '<br><b>authIdStr:</b> ' + esc(order.authIdStr) : '') +
            (order.shopName ? '<br><b>Loja:</b> ' + esc(order.shopName) : '') +
            (order.warehouseId ? '<br><b>Armazém ID:</b> ' + esc(order.warehouseId) : '') +
            '</div>' : '') +
          (state.url ? '<div style="margin-top:20px"><a href="' + esc(state.url) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;height:46px;padding:0 18px;border-radius:9px;background:#101828;color:#fff;text-decoration:none;font-weight:900">Abrir PDF da etiqueta</a>' +
            '<div style="margin-top:10px;font-size:11px;color:#667085;word-break:break-all">' + esc(state.url) + '</div></div>' : '') +
          (state.kind === "error" ? '<div style="margin-top:18px"><button id="kz-label-retry" style="height:40px;padding:0 14px;border:0;border-radius:8px;background:#101828;color:#fff;font-weight:800;cursor:pointer">Tentar novamente</button></div>' : '') +
        '</div>' +
      '</div>';

    root.querySelector("#kz-label-retry")?.addEventListener("click", () => location.reload());
  }

  async function jsonFetch(url, options = {}) {
    const response = await pageFetch(url, { credentials: "include", ...options });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("O UpSeller não retornou JSON. Verifique se esta conta continua logada.");
    }
    const json = await response.json();
    if (!response.ok) throw new Error((json && (json.msg || json.message)) || ("HTTP " + response.status));
    return json;
  }

  async function postForm(url, entries) {
    const body = new URLSearchParams();
    for (const [key, value] of entries) body.append(key, String(value));
    return jsonFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body: body.toString()
    });
  }

  function extractList(json) {
    const candidates = [
      json?.data?.list,
      json?.data?.records,
      json?.data?.pageInfo?.list,
      json?.data?.page?.list,
      json?.list,
      json?.records
    ];
    return candidates.find(Array.isArray) || [];
  }

  function visibleOrderNo(order) {
    return norm(order?.orderNumber || order?.orderNo || order?.commonNo || order?.platformOrderNo).toUpperCase();
  }

  async function findOrder() {
    const attempts = [
      { orderState: "in_process", labelStatus: "success", printCount: "0" },
      { orderState: "in_process", labelStatus: "success" },
      { orderState: "in_process" },
      {}
    ];

    for (const extra of attempts) {
      const base = [
        ["timeType", "0"],
        ["searchType", "0"],
        ["searchValue", targetOrderNo],
        ["sortName", "1"],
        ["sortValue", "0"],
        ["isVoided", "0"],
        ["pageNum", "1"],
        ["pageSize", "300"],
        ["warehouseType", "0"]
      ];
      Object.entries(extra).forEach(([k,v]) => base.push([k,v]));
      const json = await postForm("/api/order/index", base);
      const list = extractList(json);
      const exact = list.find(order => visibleOrderNo(order) === targetOrderNo);
      if (exact) return exact;
    }

    // Fallback: lista inteira de "Para Imprimir" sem busca textual.
    const json = await postForm("/api/order/index", [
      ["timeType", "0"],
      ["searchType", "0"],
      ["searchValue", ""],
      ["sortName", "1"],
      ["sortValue", "0"],
      ["orderState", "in_process"],
      ["labelStatus", "success"],
      ["printCount", "0"],
      ["isVoided", "0"],
      ["pageNum", "1"],
      ["pageSize", "300"],
      ["warehouseType", "0"]
    ]);
    return extractList(json).find(order => visibleOrderNo(order) === targetOrderNo) || null;
  }

  async function collectPdf(order) {
    const idStr = norm(order?.idStr || order?.id);
    const authIdStr = norm(order?.authIdStr || order?.authId);
    if (!idStr) throw new Error("O pedido foi encontrado, mas não possui idStr.");
    if (!authIdStr) throw new Error("O pedido foi encontrado, mas não possui authIdStr.");

    state.order = {
      idStr,
      authIdStr,
      shopName: norm(order?.shopName),
      warehouseId: norm(order?.warehouseIdStr || order?.warehouseId)
    };
    state.title = "Pedido localizado";
    state.message = "Preparando a etiqueta no UpSeller...";
    render();

    const prep = await postForm("/api/order/get-print-label-order", [
      ["orderIdList[0]", idStr]
    ]);
    if (prep?.code != null && Number(prep.code) !== 0) {
      throw new Error(prep.msg || "Falha em get-print-label-order.");
    }

    const printJson = await postForm("/api/print-label", [
      ["isCos", "1"],
      ["printIdStr", idStr],
      ["authIdStr", authIdStr],
      ["isBatchPrint", "1"]
    ]);

    const uuid = typeof printJson?.data === "string"
      ? printJson.data
      : norm(printJson?.data?.uuid || printJson?.data?.id || printJson?.uuid);
    if (!uuid) throw new Error("O /api/print-label não retornou o UUID do processo.");

    for (let i = 1; i <= 35; i++) {
      state.title = "Gerando PDF";
      state.message = "Aguardando o UpSeller · tentativa " + i + "/35";
      render();
      await new Promise(resolve => setTimeout(resolve, 650));

      const check = await jsonFetch("/api/check-process?uuid=" + encodeURIComponent(uuid));
      let processMsg = check?.data?.processMsg;
      if (typeof processMsg === "string") {
        try { processMsg = JSON.parse(processMsg); } catch (_) {}
      }

      const code = Number(processMsg?.code);
      if (code === 1) {
        const pdfUrl = norm(processMsg?.msg || processMsg?.url || processMsg?.data?.url);
        if (!pdfUrl) throw new Error("Processo terminou, mas não retornou a URL do PDF.");
        return new URL(pdfUrl, location.origin).href;
      }
      if (code === -1) {
        const failMsg = norm(processMsg?.msg || processMsg?.data?.failList?.[0]?.msg);
        throw new Error(failMsg || "O UpSeller informou falha ao gerar a etiqueta.");
      }
    }
    throw new Error("Tempo esgotado aguardando a etiqueta.");
  }

  await waitBody();
  render();

  try {
    state.title = "Identificando a conta";
    state.message = "Consultando o PUID atual...";
    render();

    const home = await jsonFetch("/api/home");
    const puid = norm(home?.data?.user?.puid || home?.data?.user?.id || home?.user?.puid || home?.user?.id);
    state.puid = puid;
    render();

    if (puid !== "34552") {
      throw new Error("Abra este teste na Moto Cintra. PUID esperado: 34552. PUID atual: " + (puid || "não identificado") + ".");
    }

    state.title = "Localizando pedido";
    state.message = "Buscando " + targetOrderNo + " na fila desta conta...";
    render();

    const order = await findOrder();
    if (!order) throw new Error("Não encontrei " + targetOrderNo + " na API desta conta.");

    const url = await collectPdf(order);
    state.kind = "success";
    state.title = "Etiqueta coletada";
    state.message = "PDF obtido com sucesso. O pedido NÃO foi marcado como impresso.";
    state.url = url;
    render();
  } catch (error) {
    state.kind = "error";
    state.title = "Falha ao coletar";
    state.message = error?.message || String(error);
    render();
    console.error("[Kryzer Label Collector]", error);
  }
})();
