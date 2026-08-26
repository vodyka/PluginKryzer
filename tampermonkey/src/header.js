// ==UserScript==
// @name         Kryzer Agent
// @namespace    kryzer-agent
// @version      2.0.0
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
// ==/UserScript==

// ATENÇÃO: este arquivo é GERADO por `node build.js` a partir de tampermonkey/src/
// (header.js + src/modules/*.js + footer.js). NÃO editar kryzer-agent.user.js
// diretamente — as mudanças seriam perdidas no próximo build. Editar o módulo
// certo em src/modules/, rodar `node build.js` na pasta tampermonkey/, conferir
// com `node --check kryzer-agent.user.js` e só então distribuir o arquivo.
//
// v2.0.0 (2026-07-24): o projeto Supabase que hospedava o backend (checkin,
// papéis por computador, canva_sync) foi excluído sem chance de recuperação.
// Como esse computador é usado só pra uma operação (não é vendido/distribuído
// pra outros clientes), decidiu-se remover de vez a dependência de backend
// pros módulos do dia a dia — eles ligam direto, sem checar nada online
// primeiro. Isso deixa o agente imune a esse tipo de incidente de novo. O
// módulo canva_sync foi descontinuado (não faz mais parte deste arquivo);
// se algum dia for reativado, precisa de um backend próprio de novo.

(function () {
  "use strict";

  console.log("[Kryzer Agent] script carregado em", location.href);

  const MODULE_INITIALIZERS = [
    initCheckoutModule,
    initComprasModule,
    initAlertaVendaModule,
    initRandomModule,
  ];

  for (const init of MODULE_INITIALIZERS) {
    try {
      init();
    } catch (e) {
      console.warn(`[Kryzer Agent] erro ao iniciar módulo ${init.name}:`, e);
    }
  }

