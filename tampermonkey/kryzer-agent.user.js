// ==UserScript==
// @name         Kryzer Agent
// @namespace    kryzer-agent
// @version      2.11.0
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
// @connect      upseller.cn
// @connect      image-product-upload.upseller.cn
// @connect      image-product.upseller.cn
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/checkout.js?v=2.11.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/compras.js?v=2.11.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/alerta-venda.js?v=2.11.0
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
// Ao editar um módulo, suba também o número (?v=2.11.0) nas linhas @require
// abaixo — o Tampermonkey pode não rebuscar um @require se a URL não mudar.
//
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
