// ==UserScript==
// @name         Kryzer Agent
// @namespace    kryzer-agent
// @version      2.7.0
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
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/checkout.js?v=2.7.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/compras.js?v=2.7.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/alerta-venda.js?v=2.7.0
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
// Ao editar um módulo, suba também o número (?v=2.7.0) nas linhas @require
// abaixo — o Tampermonkey pode não rebuscar um @require se a URL não mudar.
//
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
