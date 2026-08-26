// ==UserScript==
// @name         Kryzer Agent
// @namespace    kryzer-agent
// @version      2.1.0
// @description  Agente único do UpSeller: liga direto os módulos de checkout, compras, alerta de venda e random — sem depender de nenhum backend externo pra decidir isso.
// @match        https://app.upseller.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      upseller.cn
// @connect      image-product-upload.upseller.cn
// @connect      image-product.upseller.cn
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/checkout.js?v=2.1.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/compras.js?v=2.1.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/alerta-venda.js?v=2.1.0
// @require      https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/src/modules/random.js?v=2.1.0
// @updateURL    https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/kryzer-agent.user.js
// @downloadURL  https://raw.githubusercontent.com/vodyka/PluginKryzer/main/tampermonkey/kryzer-agent.user.js
// ==/UserScript==

// ATENÇÃO: este arquivo agora é só o LOADER — carrega cada módulo direto do
// GitHub via @require (src/modules/checkout.js, compras.js, alerta-venda.js,
// random.js). NÃO existe mais build.js/bundle local: editar o módulo certo em
// src/modules/, commitar e dar push — o Tampermonkey de quem já tem o script
// instalado busca sozinho a versão nova (automático periodicamente, ou na
// hora clicando em "Check for userscript updates" no painel dele).
//
// Cada módulo em src/modules/ é autocontido: termina com
// `try { initXModule(); } catch (e) { ... }` chamando a si mesmo assim que
// carrega — não depende mais deste arquivo pra ser iniciado.
//
// Ao editar um módulo, suba também o número (?v=2.1.0) nas linhas @require
// abaixo — o Tampermonkey pode não rebuscar um @require se a URL não mudar.
//
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
