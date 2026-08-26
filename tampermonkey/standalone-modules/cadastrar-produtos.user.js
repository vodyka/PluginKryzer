// ==UserScript==
// @name         Kryzer - Cadastrar Produtos Novos (teste isolado)
// @namespace    kryzer-cadastrar-produtos-standalone
// @version      1.0.0
// @description  Cadastra em lote, direto via API, os produtos que já existiam na loja física mas ainda não foram cadastrados no UpSeller. Usa /api/sku/save-single, endpoint confirmado por captura de rede real em 2026-08-05.
// @match        https://app.upseller.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

// Endpoint e formato do payload confirmados via captura de rede real (não
// chutado): POST /api/sku/save-single, testado com 3 produtos reais
// (14023, 14284, 16011) cadastrados com sucesso pelo usuário controlando o
// próprio Chrome. Achados confirmados nessa captura:
//   - skuAliasList é uma lista de STRINGS simples (["06121-KVS-305"]), não
//     uma lista de objetos — ao contrário do que o script de recuperação de
//     EAN (restaurar-ean-apelido.user.js) tinha assumido com cautela.
//   - Precisa de um wareHouseId específico em wareHouseSkus — o valor usado
//     no teste (2126524358565934) estava ERRADO; o correto, confirmado
//     pelo usuário, é 2126524210485235.
(function () {
  'use strict';

  const PRODUTOS = [{"sku":"14284","barcode":"7908073705989","marca":"SMART FOX","titulo":"EMBRE COMPL PRIM BIZ100 02/05 - SMARTFOX - 06226-KSS-305","apelido":"06226-KSS-305"},{"sku":"16011","marca":"HONDA","titulo":"Kit Cilindro Motor Titan Start Bros 160 Original Honda","apelido":"06121-KVS-305"},{"sku":"16012","barcode":"7898485611148","marca":"MAGNETRON","titulo":"Motor Partida Arranque Fan 150 Bros 150 Titan 150 Magnetron","apelido":"90205560"},{"sku":"16015","barcode":"7898508617294","marca":"MAGNETRON","titulo":"Motor De Partida Completo Biz 125 Es Ex 2011 Ate 2021","apelido":"90205830"},{"sku":"16016","barcode":"7898485618307","marca":"MAGNETRON","titulo":"Conjunto De Trava Ignição Cg Fan 125 2008 Original Magnetron","apelido":"90264100"},{"sku":"16018","barcode":"7898508619359","marca":"MAGNETRON","titulo":"Chicote Fiação Principal Cg 150 Fan Esi 2011 2013 Magnetron","apelido":"90285870"},{"sku":"16982","barcode":"7898508616747","titulo":"CHAVE LUZ CB300 09/15 MAGNETRON 90237090","imagem":"https://image.upseller.com/data/30945/product-img/2024-11-18/a1e0450d39401d8fc9835ac20d4a470e.png"},{"sku":"14023","barcode":"7891579330383","marca":"COFAP","titulo":"AMORTECEDOR TRAS NXR150 - COFAP - MSC41004","apelido":"MSC41004","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/8698915bd31a4b95839c384c0bfebf02.jpg"},{"sku":"14041","barcode":"7899128824475","marca":"RIFFEL","titulo":"71877 - COROA COR N PIN BIZ125 - RIFFEL","apelido":"71877","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a51b07571a144957bc8bf8582dee76a1.jpg"},{"sku":"14045","barcode":"7899128883892","marca":"RIFFEL","titulo":"100711 - CAIXA DIR ESF CBX250 - RIFFEL","apelido":"100711","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/380d2a239a814344835aebba7c29ed38.jpg"},{"sku":"14049","barcode":"7892679251097","marca":"COBREQ","titulo":"0002-DE - DISCO EMBRE YBR125 - COBREQ","apelido":"0002-DE","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/9d2f76ae02af4f518a789f7ecaa3b5f8.jpg"},{"sku":"14052","barcode":"7892679253169","marca":"COBREQ","titulo":"0004-KE - EMBRE COMPL BIZ100 - COBREQ","apelido":"0004-KE","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/328b314744064bdb92714cd126ac5a2c.jpg"},{"sku":"14074","barcode":"7898485616075","marca":"MAGNETRON","titulo":"Chicote Fiação Honda Xr 250 Tornado 2006 Á 2008 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/85a910f0929749d4a9cc797b820171e2.jpg"},{"sku":"14075","barcode":"7898508613746","marca":"MAGNETRON","titulo":"Fiaçao Principal Chicote Nxr 150 Esd 2009/2010 Gas Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d675981759364ef9b8c3b4ad4ffdee50.jpg"},{"sku":"14088","barcode":"7898508614446","marca":"MAGNETRON","titulo":"Chicote Fiação Principal Magnetron Cg 150 Titan Ks 2009-2010","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/5eb4fa6fd7694e238109a1c330d8bfd9.jpg"},{"sku":"14094","barcode":"7908180601129","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL TITAN125 KS 02/04 - 90285030 - MAGNETRON","apelido":"90285030","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/142645dc9ede4299b2dde304476017aa.jpg"},{"sku":"14095","barcode":"7908180601662","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL TITAN125 ES 00/01 - 90285020 - MAGNETRON","apelido":"90285020","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/93993f389ac74f60bcc68f3970e53e35.jpg"},{"sku":"14098","barcode":"7898485615665","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL CG125 87/91 - 90285240 - MAGNETRON","apelido":"90285240","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/7b9475fccb714d31b2ab768af1c50801.jpg"},{"sku":"14100","barcode":"7898485616105","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL CBX250 06/08 - 90285420 - MAGNETRON","apelido":"90285420","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/1acd2365dec4409091fc3748e8baa254.jpg"},{"sku":"14101","barcode":"7898485616099","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL CBX250 04/05 - 90285410 - MAGNETRON","apelido":"90285410","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/c81876cac9fa4c05bf8d9b2e4d76da3a.jpg"},{"sku":"14102","barcode":"7898485616082","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL CBX250 01/03 - 90285400 - MAGNETRON","apelido":"90285400","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/53afed6492d6414b874dcd3fafd537aa.jpg"},{"sku":"14150","marca":"HONDA","titulo":"REGULADOR PRESSAO - HONDA -","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3e64200742c64184a6894626fc16fdfc.jpg"},{"sku":"14153","marca":"HONDA","titulo":"Kit Embreagem Titan 150 2008 2009 2010 2011 Original Honda","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/594a377d923c4cf5bbc1662f96e3450c.jpg"},{"sku":"14167","marca":"HONDA","titulo":"GUIA CORRENT TRANS CB250F 06/19 - HONDA -","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/f28071257de440e0b2639499403ab5d1.jpg"},{"sku":"14183","barcode":"7899258704623","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6304 ZZE C3","apelido":"6304ZZEC3"},{"sku":"14190","barcode":"7899248180451","titulo":"Guia E Tensor Corrente De Comando Cbx200 Nx200 Xr200 Crf230","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/09be29252d53420899e34e6fa4f39f06.jpg"},{"sku":"14191","barcode":"7898924047378","marca":"WGK","titulo":"Comando De Válvulas Cbx 200 Xr 200 Nx 150 200 Crf 230 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2a31432afea242f8be0a2dc72714b1a1.jpg"},{"sku":"14192","barcode":"7890537115123","marca":"KS","titulo":"VALVULA ESC. CBX/NX 150/200 88/93 - KS - 50017786","apelido":"50017786","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/c2993bc3742b40d4b688ebc7217dcb81.jpg"},{"sku":"14193","barcode":"7890537115116","marca":"KS","titulo":"VALVULA ADM. CBX/NX 150/200 88/93 - KS - 50017785","apelido":"50017785","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/46405e548fd94c2fb1b92f774599b760.jpg"},{"sku":"14195","barcode":"7898924047583","marca":"WGK","titulo":"Braço Oscilante Balancim Cbx 200 Crf 230 Nx 200 Xr 200 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a7085773c2e8476cafc713ed24d4725f.jpg"},{"sku":"14198","barcode":"7899258700441","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6002 ZE","apelido":"6002ZE","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/6b908df486004c368e9a12622e502f83.jpg"},{"sku":"14210","barcode":"7897707513376","marca":"NGK","titulo":"Vela De Ignicao Ngk Iridium Royal Enfield Himalayan 411 2016","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/6df514897e9b44b68eb1819e4ba1a0ac.jpg"},{"sku":"14225","barcode":"7899258700731","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6004 ZE","apelido":"6004ZE"},{"sku":"14227","barcode":"7898924047927","titulo":"Placa De Partida 4º Geração Cb 300 / Xre 300","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/84786e815d974ccda17e5e530417243f.jpg"},{"sku":"14229","barcode":"7899128883984","marca":"RIFFEL","titulo":"CORRENT COM TITAN150 04/08 - RIFFEL - M406","apelido":"M406","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d29cd001f7ae4cbcbf6e6cb89f4eac69.jpg"},{"sku":"14247","barcode":"7898558330235","marca":"WGK","titulo":"Placa Partida Cremalheira Yamaha Fazer Lander Tenere 250 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/5bbbb097b6af4aeca3b31b669e6dbe1d.jpg"},{"sku":"14254","barcode":"7897707509560","marca":"NGK","titulo":"Vela De Ignição Ngk Cr8eh9s Honda Cb Twister Xr Tornado 250","apelido":"CR8EH9-S","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e3a1586d2d9e4c6993feb8677738cc05.jpg"},{"sku":"14258","barcode":"7898558338347","marca":"WGK","titulo":"EIXO SECUNDARIO YBR125 00/07 - WGK - 10115821","apelido":"10115821","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3a43b3aec7e34a03bf000f858f8a19e4.jpg"},{"sku":"14263","barcode":"7899258700212","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6001","apelido":"6001","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/ba131bfac0a04dbd869c3c84edbb1f5b.jpg"},{"sku":"14279","barcode":"7898558330129","marca":"WGK","titulo":"Arvore Comando Wgk Titan Fan Nxr 150 Bros A Partir De 2006","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/4ebfbb5e27484fe6879ba149faf76658.jpg"},{"sku":"14285","barcode":"7898542742365","titulo":"Kit Embreagem Completa Honda Biz 100 1998 Até 2005 C 100","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/084c41b629e9442dad449ff3cadbaeda.jpg"},{"sku":"14293","barcode":"7899468071744","titulo":"Guia Corrente Comando Yamaha Fazer 250 Xtz 250 Lander Tenere","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/509e745cb5ce4998ad99fe6acfebc917.jpg"},{"sku":"14314","barcode":"7899101600669","titulo":"Aro Folha Pra Moto Cg150 Titan Mix 2012 Roda Traseiro","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e9e96a6c81e944e2b03c4e1166554ad6.jpg"},{"sku":"14331","barcode":"7895797810061","marca":"VINI","titulo":"Biela Completa Cg150 Titan Fan 150 Bros 150 Original Vini","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/9efdbdba863143e2a3c3bb1dcfb7a0f7.jpg"},{"sku":"14339","barcode":"7899258701721","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6202 ZE","apelido":"6202ZE"},{"sku":"14349","barcode":"7898924047163","titulo":"Tensor Acionador Corre Comando Twister Tornado Cbx 200 Xr Nx","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a5e675a56efb4ed88faa211ce0e45cb7.jpg"},{"sku":"14388","barcode":"7898324371929","titulo":"Câmara De Ar 5.00/12 Borracha Dupla Triciclo Motocar","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/223659bc6bfd489f8292572101cf737f.jpg"},{"sku":"14395","marca":"HONDA","titulo":"Filtro Óleo Falcon Cb 300 Cb 250 Twister Original Honda","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/7d9a6d4f4d564eb49b13615bc193a481.jpg"},{"sku":"14412","barcode":"7899101622197","titulo":"Cavalete Lateral Suzuki Yes 125 Intruder 125 Pro Tork","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/bc6c6b8970dd4187bc84020dd78ef534.jpg"},{"sku":"14417","barcode":"7898558338354","marca":"WGK","titulo":"Eixo Secundário Do Pinhão Cg 125 Titan 125 Fan 92 Até 08 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/bcc00a01a95e4cd2829b0ac005e62e53.jpg"},{"sku":"14425","barcode":"7898558338187","marca":"WGK","titulo":"Pino Braço Oscilante Fan 125 Até 2008 Wgk Oferta","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e38f2c9e6292406d81a528cb7d9bcb3e.jpg"},{"sku":"14427","barcode":"7898558338125","marca":"WGK","titulo":"Kit Comando Válvula Cg Titan 125 83 A 99 Xlr 125 97 A 00 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3847521a79d0418dbe9a6b26de578127.jpg"},{"sku":"14464","barcode":"7899258703336","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6302 ZE","apelido":"6302ZE","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2a7954429c044dcc86249f2e35075dc2.jpg"},{"sku":"14465","barcode":"7899258703121","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 63/28 NSL2","apelido":"63/28NSL2","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/50497db262ce49419acf23079754e2fa.jpg"},{"sku":"14469","barcode":"7899258703480","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6303 ZE","apelido":"6303ZE"},{"sku":"14470","barcode":"7899258702278","marca":"NACHI","titulo":"ROLAMENTO ESF - NACHI - 6203 ZE","apelido":"6203ZE"},{"sku":"14485","barcode":"7898644720902","titulo":"Guia Corrente Balança Saboneteira Xr 250 Tornado 1507","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3cbc1dde07aa4a09822949d6718eb385.jpg"},{"sku":"14499","barcode":"7898558330266","marca":"WGK","titulo":"Arvore Comando Preparada Tornado Xr 250 Wgk 305º Média Alta","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/6dc4509a2b93442e95a2c5fed7d0210f.jpg"},{"sku":"14510","barcode":"7898485615382","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL BIZ100 KS 02/05 - 90285110 - MAGNETRON","apelido":"90285110","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/b26639339b9244ff87acc827e6eb5191.jpg"},{"sku":"14516","titulo":"Guia Tensor De Corrente Nxr 150/160 Bros","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/38d70fc51f8041e0ace830407a1ab811.jpg"},{"sku":"14526","barcode":"7898558338545","marca":"WGK","titulo":"Acionador Tensionador C/ Catraca Ninja 300 Mod. Original Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/65e1cf5e319f46f598abe73683107176.jpg"},{"sku":"14527","barcode":"7898924047477","titulo":"Ressalto Comando Preparado Cg Titan 2000 Fan 125 Até 08 292°","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/0cc6baa3492741a7adf125936d4e1977.jpg"},{"sku":"14528","barcode":"7898924047507","titulo":"Placa De Partida 4º Geração Wgk Yamaha Xt 225 Tdm 225","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d9731a551d0c4882ac01484ee354dd0f.jpg"},{"sku":"14531","barcode":"7898558337457","titulo":"Coroa Comando Preparação C Regulagem Cbx 250 Twister Tornado","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/161ff00d4d3e4978b8b527e15265e9fb.jpg"},{"sku":"14532","barcode":"7898558336558","titulo":"ARVORE COM VALV WGK FAZER/FACTOR/CROSSER 125/150","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/700355a752f64f67a39d53829195af42.jpg"},{"sku":"14533","barcode":"7898558336534","titulo":"Árvore Comando Completo C/ Rolamento Biz 125 2011 A 2020 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/58c132f90613427eb1677e6e35b58db7.jpg"},{"sku":"14536","barcode":"7898924047125","titulo":"Comando Preparado Wgk Bravo Crf 250f Cb 250f Twister 260º","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/937bb3948b7b426e93f7a88b51b323c3.jpg"},{"sku":"14546","barcode":"8727900350067","titulo":"Lâmpada Farol Biz Bros Pop Dream M5 Philips Efeito Xenon","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/cb295ee394dd4857a1ace025d6570b16.jpg"},{"sku":"14561","barcode":"7898558330136","titulo":"Comando Preparado Bravo Wgk Cg 150/125 Ohc 315°","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/8fbf56a40b434080b91bbfa4e4c8d375.jpg"},{"sku":"14566","barcode":"7898924047804","marca":"WGK","titulo":"Arvore Comando Valvulas Cbx 250 Twister Xr 250 Cb 300 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/bcb0488a94fc49f0adf96e2037a46e1a.jpg"},{"sku":"14571","titulo":"Disco Embreagem Xr 250 Tornado Cbx 250 Twister Mod Original","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/1440c870818d4fa0b610115bd0a87e23.jpg"},{"sku":"14573","titulo":"Kit Chave Ignição Lander 250 2008 Contato Yamaha Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/acc573f4f62342ea8d93c80a738c1e2f.jpg"},{"sku":"14576","barcode":"7899128883960","titulo":"CORRENT COMAND YBR125 06/.. - RIFFEL - M404","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/5c86e6a746574ac2a72885fb948ec563.jpg"},{"sku":"14577","barcode":"7899128883953","titulo":"CORRENT COMAND INTRUDER125 00 - RIFFEL - M403","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/4d1156eadc564dcf80afd0a6d9350ef8.jpg"},{"sku":"14584","barcode":"7894152050074","titulo":"Caixa Direção Titan 125 150 160 Fan Esférica Danidrea","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/295cdfd312b54775b819783cd0ea5426.jpg"},{"sku":"14638","barcode":"7899641815578","titulo":"JUNTA SUP FAZER250 - VEDAMOTORS - VS10610090195"},{"sku":"14659","barcode":"7899641802257","titulo":"Jogo Junta Completo Vedamotors Biz 100 Dream Hunter Web 100","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/bb2901dabb8f403da3fd317922c2ea40.jpg"},{"sku":"14662","barcode":"7899641801700","titulo":"Jogo Junta Completo Motor Vedamotor Cg 125 Titan Today 93-99","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/b1c97ef24def4ab0bca5f77ec58f38d8.jpg"},{"sku":"14686","barcode":"7898485617041","titulo":"Rele De Partida Suzuki Yes 125 2005 2006 2007 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/c1d6b4cee5af41c9995bbff1c4c17813.jpg"},{"sku":"14701","barcode":"7898508618543","titulo":"Boia Combustivel Cg 150 Titan Flex 2011 Até 2013 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/f9fd397c31224d398abdf9c4fd5d3be8.jpg"},{"sku":"14710","barcode":"7898508611537","titulo":"Interruptor De Partida Emergência Magnetron Cbx 250 Twister","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/80326fc117ec40cea884e3c5fe0c9b87.jpg"},{"sku":"14715","barcode":"7898485611810","titulo":"Interruptor Stop Freio Traseiro Honda Cg 125 Titan Today","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d07f1cfd3acf4d4d960d3badb1105b36.jpg"},{"sku":"14720","barcode":"7898485615948","titulo":"Estator Completo Ybr Xtz 125 Factor 2006 A 2010 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/ebda5524c1284da2af537d7d6afeeb32.jpg"},{"sku":"14728","barcode":"7898485617812","titulo":"Estator Gerador Cg Titan 150 2009 2010 2011 2012 2013","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/9e3be791667a4adca230036711a37a49.jpg"},{"sku":"14731","titulo":"Estator Cg 125 Titan 2003 A 2004 Cg 125 Fan 2005 A 2008","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2456403217f1452990a7aa204c72af72.jpg"},{"sku":"14733","barcode":"7898485614323","titulo":"Estator Alternador Magnetron 90271630 12v S/base Cg150 Titan","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/86b88d48dd7941d1ac2118bfbea6dadf.jpg"},{"sku":"14756","barcode":"7898485617959","titulo":"Chave Ignição Miolo Magnetron Bros 150 125 Twister 250 01-05","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/f92b675cbf26439c9a0b1da48a6215c7.jpg"},{"sku":"14760","barcode":"7898508610608","titulo":"Chave Luz Nxr 150 Bros 09-2014 Ks Es Esd Mix Flex Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/5853c34ae9a044d291e44d3a1b862a3d.jpg"},{"sku":"14764","barcode":"7898485619663","titulo":"Punho Chave Luz Magnetron Honda Cbx 250 Twister 2001 A 2005","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/803eb6573a2645429d38f3bd86a8e578.jpg"},{"sku":"14770","barcode":"7898485614460","titulo":"Cdi Cg 150 Titan Es Até 2008 Magnetron Com Garantia","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/33cd0610fa0d4c00bbd98cd56cbee7d5.jpg"},{"sku":"14772","barcode":"7898485613821","titulo":"Cdi Today Titan 1992 À 99 Titan 2000 À 2001 Magnetron 05451","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/187b3f3b9daf444dabed55e35aff682c.jpg"},{"sku":"14778","barcode":"7898485611667","titulo":"Bobina De Força Today Titan 125 99 Xlr 125 98 Á 00 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/1b657ddc4b844d69a9690cb9f2cd1c03.jpg"},{"sku":"14789","barcode":"7892415849304","titulo":"Filtro Combustível Metal Leve Nxr Bros Cg 150 Mix Xre 300","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/999f6869897a4a27a27f1281b7ddbe74.jpg"},{"sku":"14837","barcode":"7894766668719","titulo":"Biela Cb300 Xre300 Cb 300 Xre 300 Metal Leve Mahle Original","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/b221c568d44144019f4488b8f797ec1c.jpg"},{"sku":"14840","barcode":"7894766668702","titulo":"Biela Completa Metal Leve Bl-9350 Fan 125 Ks Es 2009-2017","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/8d2e2a17fd1e4fbfa72669cadd35a772.jpg"},{"sku":"14854","barcode":"7892415938497","titulo":"Kit Cilindro Motor Força Biz 125 06/08 Metal Leve Carburada","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3fab590873864acfa11a5737394deddd.jpg"},{"sku":"14856","barcode":"7892415937018","titulo":"Kit Cilindro Pistão Anéis Cbx 200 Strada Xr Nx Metal Leve","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/db1a6940170649279c63f7d84dbb0903.jpg"},{"sku":"14858","titulo":"KIT MOTOR TITAN160 - METAL LEVE - K-9825"},{"sku":"14865","barcode":"7894873025504","titulo":"Retentor Pinhao Ybr 125, Xtz 125, Dt200 Corteco","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/17e035319bfe4f29bf7baa3a8e1ba83c.jpg"},{"sku":"14908","barcode":"7892679201320","titulo":"Pastilha De Freio Dianteira Neo 125 Ubs 2016-2020","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d5a8d1aae1414622ab78791fce367d73.jpg"},{"sku":"14940","barcode":"8719018000569","titulo":"Lâmpada H4 Philips Xtreme Vision Moto 60/55w","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/26619781ba9e4f5ca763d9a4465c24c4.jpg"},{"sku":"15014","barcode":"7899761405215","titulo":"Engrenagem Embreagem De Partida Biz 110 2016 Ate 2021","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2265e194894140c3a814574bd70431a5.jpg"},{"sku":"15021","titulo":"Kit Chave Ignição Nx 400 Falcon 2006 2007 2008 3 Peças","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e383324368b04ae39460b30875194ca9.jpg"},{"sku":"15031","barcode":"7898558337463","titulo":"Coroa Do Comando Com Regulagem Wgk Bravo Crf 230","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/0886284504284d268f48535e0255fc3a.jpg"},{"sku":"15052","barcode":"7895797870638","titulo":"Placa De Partida Dafra Speed 150 Kansas 150 Mirage Max 125","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/7e4cab9a5b5846958b9d2ee9007a15f0.jpg"},{"sku":"15086","barcode":"7898508615375","titulo":"Estator Magneto 11 Bobina Mca/mcf 15/16 Motocar","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/4f7b267e32e04b548c6075f0b9506ee1.jpg"},{"sku":"15101","barcode":"7899248102118","titulo":"Espelho De Freio Dianteiro Cg Fan 125 2009 2010 2011 2013","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/32ca2bb3981841389876e52c35c4fc1b.jpg"},{"sku":"15149","barcode":"7899468049989","titulo":"Lente Acrílico Painel Fan 125 Fan 150 14 15 Fan 160 1 Botão","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e27bc9169ab84bd1b7d46d54a07667d1.jpg"},{"sku":"15186","barcode":"7898558335827","titulo":"Braço Oscilante Balancim Ys 150 Fazer Ybr 150 Factor Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a14911ae6b1b4bb49616b0ccca0239da.jpg"},{"sku":"15188","titulo":"Tensor E Guia Corrente Comando Ybr125 Factor125 Xtz125 06-12","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/1954b986a63b44d083459e24ccc8994e.jpg"},{"sku":"15215","barcode":"7898558333380","titulo":"Caixa Direção Moto Yamaha Xtz 125 Xtz 150 Crosser - Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/4f5eeeaf1cea4d4a9db7304935d7c4dd.jpg"},{"sku":"15218","barcode":"7898558339177","titulo":"CAIXA DIR CON WGK NXR 125/150/160","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/0d713ec9d9af4f418c98031eed314504.jpg"},{"sku":"15220","barcode":"7898558330372","titulo":"Caixa Direção Esférica Dafra Kansas 150 / Mirage 150 - Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/9a7f236edda1443f92897f58206df1ce.jpg"},{"sku":"15221","barcode":"7898558335292","titulo":"Balancim Admissão / Escape Ybr / Xtz 125 Factor 125 Par Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/432363836bab48faa0fecba8b521bbed.jpg"},{"sku":"15227","barcode":"7898508612084","titulo":"Chave De Luz Nx 200 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e9044c88b89f45b9aa380ab680191842.jpg"},{"sku":"15228","barcode":"7898508610592","titulo":"Punho Luz Honda Cbx 200 Strada Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/5b63fb091709445db483adbf34b0fe41.jpg"},{"sku":"15235","barcode":"7898485616303","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL POP100 07/08 - 90285440 - MAGNETRON","apelido":"90285440","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/54c20ccb6be14b8ba76d3c8b7cec97a2.jpg"},{"sku":"15239","barcode":"7898485615696","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL XLX250 87/94 - 90285270 - MAGNETRON","apelido":"90285270","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/dfd05a0dc80244748ab95776ee784be0.jpg"},{"sku":"15244","barcode":"7899761403525","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL NXR160 ESD/EDD 15/17 - 90286110 - MAGNETRON","apelido":"90286110","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/b912eb575a974b0daca4579338c630dd.jpg"},{"sku":"15246","barcode":"7898485616044","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL NX400 06/08 - 90285360 - MAGNETRON","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/7703cfad45ff46758cc9b4fa348dbe28.jpg"},{"sku":"15248","titulo":"JUNTA COMPL TITAN150 - HONDA - H0621KRM900","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2a74c099c6dc4e18b3a41f6996ba6905.jpg"},{"sku":"15258","barcode":"7898558331560","titulo":"DISCO EMBRE FAZER250 - WGK - 1018661","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/1a01afea76d44491a10174e70ee1b3b0.jpg"},{"sku":"15292","barcode":"7898924047446","titulo":"Esticador Tensionador Corrente Comando Sahara/xlx250-350 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2df54b30e2154204b7b4539d856e9878.jpg"},{"sku":"15297","barcode":"7898924047651","titulo":"Tampa Carter Bujão Óleo Completo Suzuki Yes Intruder 125","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a938baa36e204df59b2a38c0915d4519.jpg"},{"sku":"15301","barcode":"7898558339474","titulo":"Corrente De Comando Titan 150/fan 150/nxr 150 Bros Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/226184340cc94826b4baa3270ad0b8b2.jpg"},{"sku":"15302","barcode":"7898558331270","titulo":"Corrente De Comando Cbx200 Strada / Nx 200 / Xr 200 Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a61c6112b48e46f4954d7d2527229771.jpg"},{"sku":"15309","barcode":"7898558330426","titulo":"Braco Oscilante Balancim Honda Titan 150 Fan Nxr Par Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/23bed47894ec49d9bf6bddca6c7d5888.jpg"},{"sku":"15335","barcode":"7899128813394","titulo":"Kit Relação Max Honda Bros150 Nxr 150 Bros 2008 2009 2010","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/c4f775242fbd4c39956b0544eee4b79a.jpg"},{"sku":"15549","barcode":"7899468095153","titulo":"Embreagem Completa Shineray Xy 50q - Phoenix 50 Gold.","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d26648d1af56423b9abff2a26e0befbd.jpg"},{"sku":"15552","barcode":"7898508614170","titulo":"CHAVE LUZ FAZER250 05/10 - MAGENTRON - 90235590","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d00a7950deca4dd2bd8489ad429b3a28.jpg"},{"sku":"15677","barcode":"27898421572889","titulo":"Borracha Estribo Wester Ybr 125 Ybr 125 Factor 2009 A 2015","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d106f34ccad54961b7dfd029d7c68167.jpg"},{"sku":"15719","barcode":"7899761407806","marca":"MAGNETRON","titulo":"CABO ACELERADOR B FAZER250 11/15 - MAGNETRON -","apelido":"90281570","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/3a106ecc5c8b4aaab504065dd79c7a4f.jpg"},{"sku":"15756","barcode":"7899641815462","titulo":"JUNTA ACIONADOR FAZER250 - VEDAMOTORS - VS10044090187","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e45f44ed57ce456bacdb6cbd15bc6995.jpg"},{"sku":"16008","barcode":"7899613900936","titulo":"Filtro De Combustível Flex Titan Fan Bros Xre190 Bico Fino","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/394060447b8b4b5ea287ea68d7bcbd64.jpg"},{"sku":"16009","barcode":"7894766684689","titulo":"BIELA COMPL lead110 - METAL LEVE - BL9824","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/2e2e11ef34264f50bc4a3f0b84ead46f.jpg"},{"sku":"16019","barcode":"7908189364766","titulo":"RM113342 ROLAMENTO MOTOR - WHX"},{"sku":"90217060","titulo":"Bomba De Combustível Cg 150 Fan Esdi 2009 2010 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/2b6ee8893563402993292e5a291f9d84.jpg"},{"sku":"90235020","titulo":"Punho Chave De Luz Cg 150 Fan 2010 2011 2012 2013 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/2d83b7eae4ef4ce4b5cbb4f62c9b0074.jpg"},{"sku":"90235310","titulo":"Interruptor De Partida Honda Cbx 250 Twister 2006 2007 2008","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/660022b0eeea4ecd84752820d02373a3.jpg"},{"sku":"90237090","barcode":"7898508616747","titulo":"CHAVE LUZ CB300 09/15 MAGNETRON 90237090","imagem":"https://image.upseller.com/data/30945/product-img/2024-11-18/a1e0450d39401d8fc9835ac20d4a470e.png"},{"sku":"90237740","titulo":"CHAVE CB500","custo":30.68},{"sku":"90260210","titulo":"Chave Ignição Contato Miolo Cg 150 Fan Esi 2010 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/9a64b9f35f0b49e490aab12dbd2a928c.jpg"},{"sku":"90264040","titulo":"Chave Ignição Travas Yamaha Xtz Crosser 150 2018 2019 2020","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/d1e14b93d7e34c6d81c9ee687236ac33.jpg"},{"sku":"90264100","barcode":"7898485618307","marca":"MAGNETRON","titulo":"CONJUNTO TRAVAS FAN125 05/05 MAGNETRON 90264100","imagem":"https://image.upseller.com/sku_img/30945/2024-11-14/90264100-8302.jpg","custo":49.84},{"sku":"90264210","titulo":"Kit Chave De Ignição Travas Xr 200 1994 A 2002 3 Peças","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/ee117d225d96455c869ffc9e8b47415b.jpg"},{"sku":"90264540","titulo":"Conjunto De Travas Yamaha Ys Fazer 250 2008 2009 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/8e632649a00b43bead1258f0e5d4900a.jpg"},{"sku":"90264580","marca":"MAGNETRON","titulo":"CHAVE IGNICAO XTZ125 MAGNETRON 90264580","imagem":"https://image.upseller.com/sku_img/30945/2024-11-14/90264580-6317.jpg","custo":60.62},{"sku":"90278010","titulo":"Estator Yamaha Ybr 125 2002 03 04 2005 Original Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/05a85503dfb04de0b8a088a1d62e63c0.jpg"},{"sku":"90285120","marca":"MAGNETRON","titulo":"FIACAO PRINCIPAL TITAN150 KS 04/08 90285120","imagem":"https://image.upseller.com/sku_img/30945/2024-11-26/90285120-774.jpg","custo":105},{"sku":"90285810","titulo":"Chicote Fiação Cg 150 Titan Flex Es Ex 2010 2011 Magnetron","imagem":"https://image.upseller.com/sku_img/30945/2025-10-03/2050409950b848fdb07822f34bcce991.jpg"},{"sku":"90295080","barcode":"7899761409664","titulo":"Kit De Embreagem Moto Honda Cg 150 Titan/Fan/Start/Cargo Cg 125 Fan 2009 - 2015 Nxr 150 Bros Magnetron"},{"sku":"K02055","titulo":"Kit Válvula Admissão E Escape Fazer 250 Xtz Lander Tenere","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e7ad47ca04684e6499ef1f96fa84017a.jpg"},{"sku":"K02072","titulo":"Rolamento Virabrequim Titan 160 Fan Start Nxr160 Bros Nachi","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/927858f5da454b55857a834a6b0b4b1b.jpg"},{"sku":"K02073","titulo":"Rolamento Balanceiro Twister 250 / Tornado 250 Par Original","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/f50601ad7bac4bc0bfc0b20ba6e03d69.jpg"},{"sku":"K02086","titulo":"Combo C/ Acionador Wgk E Corrente Comando Fazer Lander 250","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/274dd1205d46465194e05619cd184457.jpg"},{"sku":"K02094","titulo":"Kit Acionador Com Catraca Cb 300 Xre 300 Corrente Comando","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/dedb012c48da43e4b66bf273f312715e.jpg"},{"sku":"K02100","titulo":"Chave Punho Luz E Partida Cbx 250 Twister 01/05 2 Peças","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/e881beb7a8184b26b1847d6fcfd6aee7.jpg"},{"sku":"K02106","titulo":"Kit Comando + Par Balancim Honda Cg 125 Titan 2000 Fan Wgk","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/480ade21a97d47ae8d85271f2b1d76e3.jpg"},{"sku":"K02135","titulo":"Rolamentos Eixo Primário L.esq + L.dir Cg 150 Tit Fan Origin","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/d172410ef72b4a619a99df993439f974.jpg"},{"sku":"K02152","titulo":"Kit Embreagem Primaria E Secundaria Biz 100 Dream Web","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/7c9136047d35490e9eb1cb4c98c0a861.jpg"},{"sku":"K03107","titulo":"Rolamento Virabrequim Xre 300 Cb 300 Original Honda + Juntas","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/8c4856603b644ac6b2fb55bd3cdeb60d.jpg"},{"sku":"K03108","titulo":"Biela + Rolamento Virabrequim Cg 125 Titan 92 Até 99","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/9ad7876bec3441a789c5b07c21656b9e.jpg"},{"sku":"K03113","titulo":"Guia E Tensor, Tensionador E Corrente Comando Twist Cbx 250","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/acbc833b09b044eaa9d6695533c80daa.jpg"},{"sku":"K04036","titulo":"Kit Retentores Corteco Motor Ybr 125 Ed / E Factor (04 Und)","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/a5e59756e79f49d697f4f3499d24111e.jpg"},{"sku":"K04119","titulo":"Kit Acionador Corrente Guia Tensor Yamaha Fazer Lander 250","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/74408b0ac3aa4264af48d987f57fcb9e.jpg"},{"sku":"K05101","titulo":"Kit Rolamento De Roda Xt 660 Meiota Todas Nachi Original","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/60d02f27575b45cea4d46f3a389cd81c.jpg"},{"sku":"K08112","titulo":"Válvula Admissão Escape Retentores Xlx 350 Sahara Metal Leve","imagem":"https://image.upseller.com/sku_img/30945/2026-01-13/cb00cf6c0a6049eb8e9f2bd462ef69a9.jpg"}];

  const WAREHOUSE_ID = '2126524210485235';
  const INDEX_URL = '/api/sku/index-single';
  const SAVE_URL = '/api/sku/save-single';
  const GENERATE_SIGN_URL = '/api/media/file/upload/generate-sign';
  const UPLOAD_CALLBACK_URL = '/api/media/file/upload/callback';
  const SCAN_CONCURRENCY = 6;
  const APPLY_CONCURRENCY = 2; // mais baixo pq inclui upload de imagem

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  function normSku(v) {
    return String(v ?? '').trim().toUpperCase();
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let i = 0;
    async function run() {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  // ---- catálogo (pra não cadastrar duplicado) ----

  async function fetchCatalogSkuSet(onProgress) {
    const set = new Set();
    const pageSize = 300;
    let pageNum = 1;
    for (;;) {
      const { json } = await postJson(INDEX_URL, { pageNum, pageSize, sortName: '0', sortValue: '0', searchGroup: 1 });
      if (!json || json.code !== 0) throw new Error(json?.msg || 'Falha ao ler o catálogo.');
      const list = Array.isArray(json.data?.list) ? json.data.list : [];
      for (const item of list) { const key = normSku(item.sku); if (key) set.add(key); }
      const total = Number(json.data?.total || 0);
      onProgress?.(set.size, total);
      if (!list.length || pageNum * pageSize >= total) break;
      pageNum++;
    }
    return set;
  }

  // ---- upload de imagem (mesma sequência de 3 chamadas vista na captura manual) ----

  // GM_xmlhttpRequest só existe quando o script roda de fato dentro do
  // Tampermonkey (instalado). Se for colado no console, cai pro fetch normal.
  const hasGM = typeof GM_xmlhttpRequest === 'function';

  function downloadBytes(url) {
    if (hasGM) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url, responseType: 'arraybuffer', timeout: 60000,
          onload: res => resolve(res.response),
          onerror: () => reject(new Error('Falha ao baixar a imagem de origem.')),
          ontimeout: () => reject(new Error('Timeout ao baixar a imagem.')),
        });
      });
    }
    return fetch(url).then(res => {
      if (!res.ok) throw new Error(`Falha ao baixar a imagem de origem (HTTP ${res.status}).`);
      return res.arrayBuffer();
    });
  }

  function putBytes(url, bytes, contentType) {
    if (hasGM) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'PUT', url, data: bytes, headers: { 'Content-Type': contentType }, timeout: 60000,
          onload: res => (res.status >= 200 && res.status < 300) ? resolve() : reject(new Error(`Falha no upload (HTTP ${res.status}).`)),
          onerror: () => reject(new Error('Erro de rede no upload da imagem.')),
          ontimeout: () => reject(new Error('Timeout no upload da imagem.')),
        });
      });
    }
    return fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes }).then(res => {
      if (!res.ok) throw new Error(`Falha no upload (HTTP ${res.status}).`);
    });
  }

  async function uploadProductImage(sourceUrl, sku) {
    const ext = (sourceUrl.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
    const suffix = '.' + (ext === 'jpg' ? 'jpeg' : ext);
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const fileName = `${sku}-${Date.now()}.${ext}`;

    const bytes = await downloadBytes(sourceUrl);
    const { json: signJson } = await postJson(GENERATE_SIGN_URL, { module: 'product', spaceCode: 'SkuImage', fileName, suffix });
    if (!signJson || signJson.code !== 0) throw new Error(signJson?.msg || 'Falha ao gerar assinatura de upload.');
    const { fileKey, sign, url } = signJson.data;

    await putBytes(sign, bytes, contentType);

    const { json: cbJson } = await postJson(UPLOAD_CALLBACK_URL, { fileKey, size: bytes.byteLength, suffix });
    if (!cbJson || cbJson.code !== 0) throw new Error(cbJson?.msg || 'Falha ao confirmar upload da imagem.');

    return url;
  }

  // ---- criação do produto ----

  async function createProduct(entry, imgUrl) {
    const payload = {
      sku: entry.sku,
      title: entry.titulo || entry.sku,
      brand: entry.marca || '',
      barcode: entry.barcode || '',
      skuAliasList: entry.apelido ? [entry.apelido] : [],
      costPrice: entry.custo != null ? String(entry.custo) : '',
      imgUrl: imgUrl || '',
      currency: 'BRL',
      priceUnit: 'R$',
      description: '',
      isInvoice: 0,
      referencePrice: '',
      releaseDate: new Date().toISOString().slice(0, 10) + ' 00:00:00',
      saleStatus: '0',
      salesmanId: '',
      sizeChart: '',
      skuRelations: [],
      skuSupplierRelations: [],
      supplierLink: '',
      supplierLinkList: [{ value: '' }],
      taxGroupId: -1,
      taxOrigin: 0,
      taxUnit: 'UN',
      titleAlias: '',
      commodityHeight: '', commodityLength: '', commodityWeight: '', commodityWidth: '',
      wareHouseSkus: [{ count: '', wareHouseId: WAREHOUSE_ID }],
    };
    const { json } = await postJson(SAVE_URL, payload);
    if (!json || json.code !== 0) throw new Error(json?.msg || 'Falha ao cadastrar produto.');
    return json.data;
  }

  // ---- UI ----

  function injectStyles() {
    if (document.getElementById('kzp-style')) return;
    const s = document.createElement('style');
    s.id = 'kzp-style';
    s.textContent = `
      #kzp-btn{position:fixed;right:18px;bottom:130px;z-index:2147483000;border:0;border-radius:10px;background:#0e9f6e;color:#fff;padding:10px 14px;font:700 12px Arial;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}
      .kzp-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(16,24,40,.6);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif}
      .kzp-modal{width:min(820px,96vw);max-height:88vh;background:#fff;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
      .kzp-head{padding:16px 18px;border-bottom:1px solid #eee;font-size:15px;font-weight:800}
      .kzp-body{padding:16px 18px;overflow:auto;font-size:12px;color:#333;line-height:1.6}
      .kzp-foot{padding:12px 18px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px}
      .kzp-btn2{height:36px;border:0;border-radius:8px;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer}
      .kzp-btn2.primary{background:#0e9f6e;color:#fff}
      .kzp-btn2.secondary{background:#eee;color:#333}
      .kzp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
      .kzp-stat{background:#f7f7f8;border-radius:8px;padding:8px;text-align:center}
      .kzp-stat b{display:block;font-size:18px}
      .kzp-stat span{font-size:9px;color:#667085}
      .kzp-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
      .kzp-table th,.kzp-table td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left}
      .kzp-log{font-family:monospace;font-size:10px;background:#111;color:#0f0;padding:8px;border-radius:8px;max-height:240px;overflow:auto;margin-top:10px;white-space:pre-wrap}
    `;
    document.head.appendChild(s);
  }

  function createButton() {
    if (document.getElementById('kzp-btn')) return;
    const b = document.createElement('button');
    b.id = 'kzp-btn';
    b.textContent = 'Cadastrar Produtos Novos';
    b.onclick = runFlow;
    document.body.appendChild(b);
  }

  function modal(html) {
    document.getElementById('kzp-modal-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'kzp-modal-backdrop';
    backdrop.className = 'kzp-backdrop';
    backdrop.innerHTML = `<div class="kzp-modal">${html}</div>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  async function runFlow() {
    const btn = document.getElementById('kzp-btn');
    btn.disabled = true;
    btn.textContent = 'Lendo catálogo do UpSeller...';

    let catalogSet;
    try {
      catalogSet = await fetchCatalogSkuSet((found, total) => { btn.textContent = `Lendo catálogo... ${found}/${total || '?'}`; });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Cadastrar Produtos Novos';
      alert(`Falha ao ler o catálogo: ${e.message || e}`);
      return;
    }

    const jaExiste = PRODUTOS.filter(p => catalogSet.has(normSku(p.sku)));
    const paraCriar = PRODUTOS.filter(p => !catalogSet.has(normSku(p.sku)));

    btn.disabled = false;
    btn.textContent = 'Cadastrar Produtos Novos';

    const rows = paraCriar.map(p => `
      <tr>
        <td>${esc(p.sku)}</td>
        <td>${esc(p.titulo || '')}</td>
        <td>${esc(p.marca || '')}</td>
        <td>${p.barcode ? esc(p.barcode) : '-'}</td>
        <td>${p.imagem ? 'Sim' : 'Não'}</td>
      </tr>`).join('');

    const backdrop = modal(`
      <div class="kzp-head">Cadastrar Produtos Novos — confirmação</div>
      <div class="kzp-body">
        <div class="kzp-stats">
          <div class="kzp-stat"><b>${PRODUTOS.length}</b><span>na lista</span></div>
          <div class="kzp-stat"><b>${jaExiste.length}</b><span>já existem (pulados)</span></div>
          <div class="kzp-stat"><b>${paraCriar.length}</b><span>serão criados</span></div>
        </div>
        <p>Todos os ${paraCriar.length} produtos que vão ser cadastrados:</p>
        <div style="max-height:280px;overflow:auto"><table class="kzp-table"><thead><tr><th>SKU</th><th>Título</th><th>Marca</th><th>EAN</th><th>Imagem</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p style="margin-top:10px">Isso vai chamar <code>/api/sku/save-single</code> pra cada um dos ${paraCriar.length}, no armazém <code>${WAREHOUSE_ID}</code>. Quem tem imagem passa primeiro pelo upload (3 chamadas), o que deixa mais lento.</p>
      </div>
      <div class="kzp-foot">
        <button class="kzp-btn2 secondary" id="kzp-cancel">Cancelar</button>
        <button class="kzp-btn2 primary" id="kzp-confirm" ${paraCriar.length ? '' : 'disabled'}>Confirmar e cadastrar ${paraCriar.length}</button>
      </div>
    `);
    backdrop.querySelector('#kzp-cancel').onclick = () => backdrop.remove();
    backdrop.querySelector('#kzp-confirm').onclick = () => applyAll(paraCriar, backdrop);
  }

  async function applyAll(paraCriar, backdrop) {
    const body = backdrop.querySelector('.kzp-body');
    body.innerHTML += `<div class="kzp-log" id="kzp-log">Cadastrando...\n</div>`;
    backdrop.querySelector('.kzp-foot').innerHTML = '';
    const log = backdrop.querySelector('#kzp-log');
    const append = line => { log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; };

    let ok = 0, fail = 0;
    await mapWithConcurrency(paraCriar, APPLY_CONCURRENCY, async entry => {
      try {
        let imgUrl = '';
        if (entry.imagem) {
          try { imgUrl = await uploadProductImage(entry.imagem, entry.sku); }
          catch (e) { append(`AVISO ${entry.sku}: imagem falhou (${e.message || e}), cadastrando sem imagem.`); }
        }
        await createProduct(entry, imgUrl);
        ok++;
        append(`OK   ${entry.sku} — ${entry.titulo || ''}`);
      } catch (e) {
        fail++;
        append(`FALHA ${entry.sku}: ${e.message || e}`);
      }
    });

    append(`\nConcluído: ${ok} cadastrado(s), ${fail} falha(s).`);
    const foot = backdrop.querySelector('.kzp-foot');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'kzp-btn2 primary';
    closeBtn.textContent = 'Fechar';
    closeBtn.onclick = () => backdrop.remove();
    foot.appendChild(closeBtn);
  }

  function boot() {
    injectStyles();
    createButton();
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
