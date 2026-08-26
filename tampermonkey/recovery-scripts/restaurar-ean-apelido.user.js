// ==UserScript==
// @name         Kryzer - Restaurar EAN/Apelido (recuperação pontual)
// @namespace    kryzer-recovery-ean-apelido
// @version      1.0.0
// @description  Ferramenta de uso único: restaura código de barras (EAN) e apelido de SKU apagados pelo bug do canva_sync, usando uma planilha antiga como fonte. Desinstale depois de usar.
// @match        https://app.upseller.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Como usar: instale este script isolado (não faz parte do agente unificado
// kryzer-agent.user.js), abra qualquer página do UpSeller logado, clique no
// botão flutuante "Restaurar EAN/Apelido" no canto da tela. Ele varre cada
// SKU da lista abaixo contra o cadastro REAL e atual do UpSeller
// (/api/sku/detail-single — a mesma fonte que checkout.js já confirma ser
// completa), decide o que precisa de restauração (só o que estiver faltando
// de verdade, nunca sobrescreve um valor já preenchido) e só aplica depois
// de você confirmar num resumo. Restaura só o campo "barcode" — que é o
// campo real "Código de Barras" que aparece na tela de editar produto
// (aceita múltiplos códigos separados por vírgula). "gtinCode" é um campo
// diferente, um código interno gerado pelo próprio UpSeller (tipo
// "SY7111105") — nunca é tocado por este script.
// Apelido (skuAliasList) só é restaurado se o script encontrar, na própria
// varredura, pelo menos um produto real com esse campo preenchido — usa
// essa estrutura como molde. Se nenhum produto tiver um exemplo vivo, ele
// pula apelido inteiramente e avisa no resumo, em vez de inventar um
// formato e arriscar gravar lixo.

(function () {
  'use strict';

  const RECOVERY_DATA = [{"sku":"14090","barcode":"7898485615399","apelido":"90285120"},{"sku":"14284","barcode":"7908073705989","apelido":"06226-KSS-305"},{"sku":"14517","barcode":"7899641811402","apelido":"VS00700000001"},{"sku":"14691","barcode":"7898485616570","apelido":"90226150"},{"sku":"14693","barcode":"7898485612404","apelido":"90226120"},{"sku":"14695","barcode":"7898485612374","apelido":"90226090"},{"sku":"14750","barcode":"7898508611568","apelido":"90260210"},{"sku":"14758","barcode":"7898508610585","apelido":"90235160"},{"sku":"14765","barcode":"7898485619632","apelido":"90235020"},{"sku":"14766","barcode":"7898485619625","apelido":"90235010"},{"sku":"14777","barcode":"7898485611735","apelido":"90210690"},{"sku":"14786","barcode":"7898485619915","apelido":"90217060"},{"sku":"15009","barcode":"7898508614361","apelido":"90217160"},{"sku":"15020","barcode":"7898485615641","apelido":"90250680"},{"sku":"15109","barcode":"7909201019206","apelido":"TM850,1104349"},{"sku":"15252","barcode":"7898508617843","apelido":"90285810"},{"sku":"16011","apelido":"06121-KVS-305"},{"sku":"16012","barcode":"7898485611148","apelido":"90205560"},{"sku":"16015","barcode":"7898508617294","apelido":"90205830"},{"sku":"16016","barcode":"7898485618307","apelido":"90264100"},{"sku":"16017","barcode":"7898485619236","apelido":"90264130"},{"sku":"16018","barcode":"7898508619359","apelido":"90285870"},{"sku":"14001","barcode":"7891579343574","apelido":"TMC410001"},{"sku":"16988","barcode":"7890903060460","apelido":"AM1030S"},{"sku":"14023","barcode":"7891579330383","apelido":"MSC41004"},{"sku":"14027","barcode":"7891579218438","apelido":"CR22540M"},{"sku":"14041","barcode":"7899128824475","apelido":"71877"},{"sku":"14044","barcode":"7899128883908","apelido":"100712"},{"sku":"14045","barcode":"7899128883892","apelido":"100711"},{"sku":"14049","barcode":"7892679251097","apelido":"0002-DE"},{"sku":"14052","barcode":"7892679253169","apelido":"0004-KE"},{"sku":"14060","barcode":"7908189312378","apelido":"CD240016C"},{"sku":"14062","barcode":"7891579352903","apelido":"MM300M"},{"sku":"14068","barcode":"7891676040017","apelido":"HTZ6L"},{"sku":"14071","barcode":"7898485617621","apelido":"90288110"},{"sku":"14073","barcode":"7898485615504","apelido":"90288030"},{"sku":"14074","barcode":"7898485616075"},{"sku":"14075","barcode":"7898508613746"},{"sku":"14080","barcode":"7898485615436"},{"sku":"14081","barcode":"7898485615429","apelido":"90285160"},{"sku":"14084","barcode":"7898508619366","apelido":"90285880"},{"sku":"14086","barcode":"7908180603192"},{"sku":"14087","barcode":"7898508612381"},{"sku":"14088","barcode":"7898508614446"},{"sku":"14658","barcode":"7899641838959","apelido":"VS05700000190"},{"sku":"14089","barcode":"7898485615610","apelido":"90285210"},{"sku":"14092","barcode":"7898485616921","apelido":"90285450"},{"sku":"14093","barcode":"7898485615313","apelido":"90285040"},{"sku":"14094","barcode":"7908180601129","apelido":"90285030"},{"sku":"14095","barcode":"7908180601662","apelido":"90285020"},{"sku":"14096","barcode":"7898485615283","apelido":"90285010"},{"sku":"14097","barcode":"7898485615276","apelido":"90285000"},{"sku":"14098","barcode":"7898485615665","apelido":"90285240"},{"sku":"14100","barcode":"7898485616105","apelido":"90285420"},{"sku":"14101","barcode":"7898485616099","apelido":"90285410"},{"sku":"14102","barcode":"7898485616082","apelido":"90285400"},{"sku":"14108","barcode":"7897707509638","apelido":"CPR8EA-9"},{"sku":"14104","barcode":"7897707511389","apelido":"CPR8EA-9S"},{"sku":"14105","barcode":"7897707508778","apelido":"CR7HSA"},{"sku":"14132","barcode":"7909201019237","apelido":"1211140"},{"sku":"14157","barcode":"7899641805692","apelido":"P40FORK455054"},{"sku":"14160","barcode":"7899954303786","apelido":"30254"},{"sku":"14162","barcode":"7899954301829","apelido":"659"},{"sku":"14172","barcode":"7898372524285"},{"sku":"14175","barcode":"7899641838409","apelido":"M730901700000"},{"sku":"14178","barcode":"87295175446","apelido":"CR7HIX"},{"sku":"14179","barcode":"4054371548513","apelido":"62072ZC07C3"},{"sku":"14183","barcode":"7899258704623","apelido":"6304ZZEC3"},{"sku":"14184","barcode":"7898456461307","apelido":"5013"},{"sku":"14187","barcode":"7899093631115"},{"sku":"14189","barcode":"7899258706443","apelido":"63022NSE9"},{"sku":"14190","barcode":"7899248180451"},{"sku":"14191","barcode":"7898924047378"},{"sku":"14194","barcode":"7898558338415"},{"sku":"14195","barcode":"7898924047583"},{"sku":"14198","barcode":"7899258700441","apelido":"6002ZE"},{"sku":"14200","barcode":"7897707505586","apelido":"DPR8EA-9"},{"sku":"14202","barcode":"7898924047101"},{"sku":"14210","barcode":"7897707513376"},{"sku":"14211","barcode":"7890903054049","apelido":"TIM1020"},{"sku":"14218","barcode":"7898644720858","apelido":"DT1504-7"},{"sku":"14219","barcode":"7899258708553","apelido":"35BC07S65NC2CS1"},{"sku":"14225","barcode":"7899258700731","apelido":"6004ZE"},{"sku":"14226","barcode":"7899258702230","apelido":"62042NSE9"},{"sku":"14227","barcode":"7898924047927"},{"sku":"14228","barcode":"7899761402429","apelido":"90286090"},{"sku":"14229","barcode":"7899128883984","apelido":"M406"},{"sku":"14231","barcode":"7899258706474","apelido":"63032NSE9"},{"sku":"14234","apelido":"91002-KPF-901"},{"sku":"14237","barcode":"7891579883315","apelido":"TIC42006"},{"sku":"15044","barcode":"7898558337944"},{"sku":"14247","barcode":"7898558330235"},{"sku":"14248","barcode":"7899954300969","apelido":"414"},{"sku":"14249","barcode":"7898558335322"},{"sku":"14253","barcode":"7899258702353","apelido":"62032NSE9"},{"sku":"14254","barcode":"7897707509560","apelido":"CR8EH9-S"},{"sku":"14255","barcode":"4146040000009","apelido":"414604"},{"sku":"14256","barcode":"4146030000002","apelido":"414603"},{"sku":"14258","barcode":"7898558338347","apelido":"10115821"},{"sku":"14263","barcode":"7899258700212","apelido":"6001"},{"sku":"14272","barcode":"7898558331225"},{"sku":"14275","barcode":"7898485615375","apelido":"90285100"},{"sku":"14279","barcode":"7898558330129"},{"sku":"14285","barcode":"7898542742365"},{"sku":"14289","barcode":"7898558336541"},{"sku":"14290","barcode":"7899468071737"},{"sku":"14293","barcode":"7899468071744"},{"sku":"15039","barcode":"7898558330525"},{"sku":"14298","barcode":"7899258708843"},{"sku":"14299","barcode":"7899258708836"},{"sku":"14300","barcode":"7898924047187"},{"sku":"14302","barcode":"7893026203813","apelido":"VW262"},{"sku":"14304","barcode":"7899258704128","apelido":"6005"},{"sku":"14314","barcode":"7899101600669"},{"sku":"14317","barcode":"7898558338132"},{"sku":"14318","apelido":"2120521"},{"sku":"14322","barcode":"4054371749477","apelido":"6007ZZEC3"},{"sku":"14323","barcode":"7899258706160","apelido":"62052NSE9C3"},{"sku":"14331","barcode":"7895797810061"},{"sku":"14334","barcode":"7899468070495","apelido":"36364"},{"sku":"14338","barcode":"7899258706733","apelido":"62022NSE9C3"},{"sku":"14339","barcode":"7899258701721","apelido":"6202ZE"},{"sku":"14340","barcode":"7899258704067","apelido":"6003ZZEC3"},{"sku":"14341","barcode":"7899258705064","apelido":"6202SPL"},{"sku":"14342","barcode":"7899258706789","apelido":"62012NSE9C3"},{"sku":"14343","barcode":"7899258702322","apelido":"62032NSE9C3"},{"sku":"14344","apelido":"91003-KRM-841,91003-KGE-G01"},{"sku":"14348","barcode":"7899128884011","apelido":"M409"},{"sku":"14349","barcode":"7898924047163"},{"sku":"14360","barcode":"7899093625749"},{"sku":"14362","barcode":"7898924002216"},{"sku":"14364","barcode":"7897707505517","apelido":"C7HSA"},{"sku":"14369","barcode":"7898508618513"},{"sku":"14377","barcode":"7899258700021","apelido":"28BCS18"},{"sku":"14388","barcode":"7898324371929"},{"sku":"14392","barcode":"7898924047132","apelido":"10115791"},{"sku":"14400","apelido":"91001-KPF-901"},{"sku":"14407","barcode":"7898149221683"},{"sku":"14412","barcode":"7899101622197"},{"sku":"14415","barcode":"7898442103570"},{"sku":"14417","barcode":"7898558338354"},{"sku":"14418","barcode":"7898924047149"},{"sku":"14421","barcode":"7899258704869","apelido":"6205NCC4"},{"sku":"14422","barcode":"7899258704852","apelido":"6205NCC3"},{"sku":"14425","barcode":"7898558338187"},{"sku":"14426","barcode":"7898924047576"},{"sku":"14427","barcode":"7898558338125"},{"sku":"14428","barcode":"7898542742358","apelido":"9564.10705"},{"sku":"14438","barcode":"7890537115000","apelido":"50017774"},{"sku":"14566","barcode":"7898924047804"},{"sku":"14440","barcode":"7898542746516","apelido":"9564"},{"sku":"14441","barcode":"7899101670723"},{"sku":"14447","barcode":"7898485616600"},{"sku":"14453","barcode":"7890008806307","apelido":"630"},{"sku":"14454","barcode":"7897707505548","apelido":"DP8EA-9"},{"sku":"14455","barcode":"7899761402412","apelido":"90286080"},{"sku":"14456","barcode":"7898542746851","apelido":"12920"},{"sku":"14464","barcode":"7899258703336","apelido":"6302ZE"},{"sku":"14465","barcode":"7899258703121","apelido":"63/28NSL2"},{"sku":"14466","barcode":"7899258708423","apelido":"60062NSEC3"},{"sku":"14468","barcode":"7899258707013","apelido":"62022NSE9"},{"sku":"14469","barcode":"7899258703480","apelido":"6303ZE"},{"sku":"14470","barcode":"7899258702278","apelido":"6203ZE"},{"sku":"14471","barcode":"7899258702391","apelido":"6204ZE"},{"sku":"14472","barcode":"7899258700045","apelido":"28BCS18NSE2"},{"sku":"14473","barcode":"7899258707129","apelido":"63022NSE9C3"},{"sku":"14474","barcode":"7899258706214","apelido":"63042NSE9C3"},{"sku":"14479","barcode":"7898542741603"},{"sku":"14485","barcode":"7898644720902"},{"sku":"14490","barcode":"0751320965318","apelido":"VC07"},{"sku":"14492","barcode":"7898542746806","apelido":"PLTB088"},{"sku":"14496","barcode":"7899258706191","apelido":"35BC07S58"},{"sku":"14498","barcode":"7898558335315"},{"sku":"14499","barcode":"7898558330266"},{"sku":"14501","barcode":"7909201013877","apelido":"1211858"},{"sku":"14503","barcode":"7899248116016","apelido":"1210277"},{"sku":"14294","barcode":"7898558334455"},{"sku":"14510","barcode":"7898485615382","apelido":"90285110"},{"sku":"14512","barcode":"7899258703305","apelido":"6302/16"},{"sku":"14515","barcode":"606529978495","apelido":"VC14"},{"sku":"14518","barcode":"7899101619661","apelido":"PC-25HC"},{"sku":"14522","barcode":"7899258705101","apelido":"6202TS2"},{"sku":"14523","apelido":"6201TS2"},{"sku":"14526","barcode":"7898558338545"},{"sku":"14527","barcode":"7898924047477"},{"sku":"14528","barcode":"7898924047507"},{"sku":"14794","barcode":"7892415580085","apelido":"GC0510099"},{"sku":"14531","barcode":"7898558337457"},{"sku":"14532","barcode":"7898558336558"},{"sku":"14533","barcode":"7898558336534"},{"sku":"14534","barcode":"7898558336459"},{"sku":"14535","barcode":"7898558336688"},{"sku":"14536","barcode":"7898924047125"},{"sku":"14537","barcode":"7898558338071"},{"sku":"14546","barcode":"8727900350067"},{"sku":"14551","barcode":"7899258702339","apelido":"6204"},{"sku":"14554","barcode":"7899258700526","apelido":"6003"},{"sku":"14557","apelido":"62012NSE9"},{"sku":"14558","apelido":"6305ZZEC3"},{"sku":"14559","apelido":"62/32C3"},{"sku":"14561","barcode":"7898558330136"},{"sku":"15076","barcode":"7898558331928","apelido":"10118151"},{"sku":"14572","barcode":"7898508614576","apelido":"90264590"},{"sku":"14576","barcode":"7899128883960"},{"sku":"14577","barcode":"7899128883953"},{"sku":"14579","barcode":"7899128882604"},{"sku":"14580","barcode":"7898508613364"},{"sku":"14584","barcode":"7894152050074"},{"sku":"14585","apelido":"6207ZZE"},{"sku":"14635","barcode":"4005108986467","apelido":"7520006100"},{"sku":"14636","barcode":"7899641810412"},{"sku":"14638","barcode":"7899641815578"},{"sku":"14639","barcode":"7899641806668"},{"sku":"14640","barcode":"7899641818111,7899640851454","apelido":"VS05610000260"},{"sku":"14641","barcode":"7899641814953","apelido":"VS0561010001K"},{"sku":"14644","barcode":"7899641803254","apelido":"VS05610000325"},{"sku":"14646","barcode":"7899641811808","apelido":"VS05610000004"},{"sku":"14647","barcode":"7899641814861","apelido":"VS0561000295P"},{"sku":"14648","barcode":"7899641801458","apelido":"VS05610000145"},{"sku":"14649","barcode":"7899641814700"},{"sku":"14650","barcode":"7899641815325"},{"sku":"14653","barcode":"7899641815622"},{"sku":"14654","barcode":"7899641806606","apelido":"VS10700000660"},{"sku":"14657","barcode":"7899641815028"},{"sku":"14659","barcode":"7899641802257"},{"sku":"14661","barcode":"7899641849696"},{"sku":"14662","barcode":"7899641801700"},{"sku":"14664","barcode":"7899641801403"},{"sku":"14668","barcode":"7899641841904"},{"sku":"14674","barcode":"7899641806835","apelido":"S410210202003"},{"sku":"14675","barcode":"7899641808297"},{"sku":"14678","barcode":"7898508611193"},{"sku":"14680","barcode":"7898485612565"},{"sku":"14686","barcode":"7898485617041"},{"sku":"14688","barcode":"7898485615061"},{"sku":"14692","barcode":"7898485612411"},{"sku":"14701","barcode":"7898508618543"},{"sku":"14702","barcode":"7898508618529"},{"sku":"14704","barcode":"7898508618000"},{"sku":"14707","barcode":"7898508613357"},{"sku":"14710","barcode":"7898508611537"},{"sku":"14711","barcode":"7898508611544","apelido":"90235310"},{"sku":"14712","barcode":"7898485616198"},{"sku":"14715","barcode":"7898485611810"},{"sku":"14716","barcode":"7898485614972","apelido":"90278930"},{"sku":"14719","barcode":"7898508615672"},{"sku":"14720","barcode":"7898485615948"},{"sku":"14728","barcode":"7898485617812"},{"sku":"14730","barcode":"7898508611209"},{"sku":"14733","barcode":"7898485614323"},{"sku":"14744","barcode":"7898508612718"},{"sku":"14751","barcode":"7899761401842"},{"sku":"14753","barcode":"7898508613319"},{"sku":"14754","barcode":"7898485617843"},{"sku":"14755","barcode":"7898485617874"},{"sku":"14756","barcode":"7898485617959"},{"sku":"14759","barcode":"7898485619830","apelido":"90235120"},{"sku":"14760","barcode":"7898508610608"},{"sku":"14763","barcode":"7898485619670"},{"sku":"14764","barcode":"7898485619663"},{"sku":"14767","barcode":"7898485619618"},{"sku":"14770","barcode":"7898485614460"},{"sku":"14772","barcode":"7898485613821"},{"sku":"14773","barcode":"7898485613067"},{"sku":"14774","barcode":"7898485617027"},{"sku":"14776","barcode":"7898485616334"},{"sku":"14778","barcode":"7898485611667"},{"sku":"14779","barcode":"7898485610837"},{"sku":"14780","barcode":"7898485610639"},{"sku":"14782","barcode":"7898485610059"},{"sku":"14789","barcode":"7892415849304"},{"sku":"14791","barcode":"7894766659083"},{"sku":"15075","barcode":"7898558332048","apelido":"10118261"},{"sku":"14508","barcode":"7909201021810","apelido":"1104447"},{"sku":"15298","barcode":"7898924047545","apelido":"1010281"},{"sku":"14529","barcode":"7898558336671,7898924047156","apelido":"1010311"},{"sku":"14193","barcode":"7890537115116","apelido":"50017785"},{"sku":"14833","barcode":"7892415478771","apelido":"VA0510070"},{"sku":"14826","barcode":"7892415973962","apelido":"VA0511477"},{"sku":"14810","barcode":"7892415478702","apelido":"VE0510135"},{"sku":"14818","barcode":"7894766665510","apelido":"VA0521673"},{"sku":"14817","barcode":"7892415557292","apelido":"VA0520199"},{"sku":"14814","barcode":"7892415478580"},{"sku":"14827","barcode":"7892415557261","apelido":"VA0510195"},{"sku":"14816","barcode":"7892415478627"},{"sku":"14828","barcode":"7892415478726","apelido":"VA0510029"},{"sku":"14824","barcode":"7894766624197"},{"sku":"14825","barcode":"7892415557278"},{"sku":"14832","barcode":"7892415478870","apelido":"VA0510128"},{"sku":"15491","barcode":"7890537128451","apelido":"50017462"},{"sku":"15254","barcode":"7898558334486"},{"sku":"14829","barcode":"7892415478979","apelido":"VA0510134"},{"sku":"15289","barcode":"7898558333755","apelido":"10111471"},{"sku":"14240","barcode":"7890537126266","apelido":"50017464"},{"sku":"14834","barcode":"7892415581969","apelido":"VA0510227"},{"sku":"14836","barcode":"7892415938442"},{"sku":"14837","barcode":"7894766668719"},{"sku":"14838","barcode":"7894766700136"},{"sku":"14839","barcode":"7892415805089"},{"sku":"14840","barcode":"7894766668702"},{"sku":"14841","barcode":"7892415805072"},{"sku":"14842","barcode":"7894766700129"},{"sku":"14843","barcode":"7892415805065"},{"sku":"14844","barcode":"7892415805607"},{"sku":"14845","barcode":"7892415644527"},{"sku":"14846","barcode":"7894766684672"},{"sku":"14847","barcode":"7894766684696"},{"sku":"14848","barcode":"7894766684665"},{"sku":"14851","barcode":"7892415810076"},{"sku":"14853","barcode":"7894766661369"},{"sku":"14854","barcode":"7892415938497"},{"sku":"14856","barcode":"7892415937018"},{"sku":"14857","barcode":"7894766659236"},{"sku":"14859","barcode":"7892415810182"},{"sku":"14860","barcode":"7892415967688"},{"sku":"14861","barcode":"7892415619198"},{"sku":"14862","barcode":"7892415619211"},{"sku":"14865","barcode":"7894873025504"},{"sku":"14866","barcode":"7894873025924,1030100114"},{"sku":"14867","barcode":"7894873067078"},{"sku":"14868","barcode":"7894873009375"},{"sku":"14869","barcode":"7894873001720"},{"sku":"14870","barcode":"7894873030829"},{"sku":"14871","barcode":"7894873002383"},{"sku":"14872","barcode":"7894873025931"},{"sku":"14873","barcode":"7894873001584"},{"sku":"14874","barcode":"7894873025948,1030107709"},{"sku":"14875","barcode":"7894873002390"},{"sku":"14876","barcode":"7894873037309"},{"sku":"14877","barcode":"7894873011064,789487301106,1006000508"},{"sku":"14878","barcode":"7894873004319"},{"sku":"14880","barcode":"7894873023562"},{"sku":"14882","barcode":"7894873025955,1030107710"},{"sku":"14883","barcode":"7894873002376","apelido":"509N"},{"sku":"14886","barcode":"7894873066422,789487306642,1030009128"},{"sku":"14890","barcode":"7894873025498"},{"sku":"14538","barcode":"7909201025139","apelido":"1211175"},{"sku":"14891","barcode":"7894873002062"},{"sku":"14899","barcode":"7892679201443","apelido":"N-1882"},{"sku":"14900","barcode":"7892679201467","apelido":"N-1876"},{"sku":"14901","barcode":"7892679201313","apelido":"N-1840"},{"sku":"14902","barcode":"7892679201252","apelido":"N-1836"},{"sku":"14903","barcode":"7892679201245","apelido":"N-1834"},{"sku":"14908","barcode":"7892679201320"},{"sku":"14915","barcode":"7892679200842","apelido":"N-988"},{"sku":"14920","barcode":"7892679200644"},{"sku":"14921","barcode":"7892679200637","apelido":"N-962"},{"sku":"14922","barcode":"7892679063577","apelido":"N-954"},{"sku":"14923","barcode":"7892679210056","apelido":"N-951"},{"sku":"14924","barcode":"7892679210032"},{"sku":"14926","barcode":"7892679062914","apelido":"N-943"},{"sku":"14928","barcode":"7892679062686","apelido":"N-940"},{"sku":"14934","barcode":"7892679201481"},{"sku":"14938","barcode":"7892679200026","apelido":"N-902"},{"sku":"14940","barcode":"8719018000569"},{"sku":"14943","barcode":"8727900377910","apelido":"H4FITMOTOC1"},{"sku":"14944","barcode":"751320965257,7890516100744","apelido":"VS250"},{"sku":"14945","barcode":"606529978501","apelido":"VS160"},{"sku":"14946","barcode":"751320965233","apelido":"VS150Y"},{"sku":"14947","barcode":"7890903061849,7891579299260,7899128813264","apelido":"VS150"},{"sku":"14955","barcode":"7899258706306","apelido":"63032NSE9C3"},{"sku":"14956","barcode":"7899248162099"},{"sku":"14957","barcode":"087295162897","apelido":"CR9EAIA-9"},{"sku":"14965","barcode":"7899651857889"},{"sku":"14967","barcode":"7898520246014"},{"sku":"14989","barcode":"7898520248216"},{"sku":"14998","barcode":"7892679253572"},{"sku":"14999","barcode":"7892679253534"},{"sku":"15003","barcode":"7898508617959"},{"sku":"15004","barcode":"7898508617942"},{"sku":"15005","barcode":"7898508617935"},{"sku":"15006","barcode":"7898508617836"},{"sku":"15010","barcode":"7898508614354"},{"sku":"15012","barcode":"7898508618734"},{"sku":"15013","barcode":"7898508618727"},{"sku":"15014","barcode":"7899761405215"},{"sku":"15017","barcode":"7898485618352"},{"sku":"15025","barcode":"7898924047033"},{"sku":"15026","barcode":"7898558338507"},{"sku":"15027","barcode":"7898558338514"},{"sku":"15028","barcode":"7898558339733"},{"sku":"15029","barcode":"7898558339467"},{"sku":"15030","barcode":"7898558339443"},{"sku":"15031","barcode":"7898558337463"},{"sku":"15032","barcode":"7898558337449"},{"sku":"15035","barcode":"7898558334233"},{"sku":"15037","barcode":"7898558335339"},{"sku":"15253","barcode":"7898558334493","apelido":"10112021"},{"sku":"15040","barcode":"7898924047385"},{"sku":"15041","barcode":"7898558336473"},{"sku":"15043","barcode":"7898558336350"},{"sku":"14815","barcode":"7892415582096"},{"sku":"15052","barcode":"7895797870638"},{"sku":"15053","barcode":"7895797870447"},{"sku":"15058","barcode":"7895797870010"},{"sku":"15074","barcode":"7898558332383"},{"sku":"14796","barcode":"7892415557414"},{"sku":"15290","barcode":"7898558333748","apelido":"10114071"},{"sku":"15081","barcode":"7898924047019"},{"sku":"15086","barcode":"7898508615375"},{"sku":"15088","barcode":"7899613921719"},{"sku":"15089","barcode":"7899613921597"},{"sku":"15090","barcode":"7895230031527"},{"sku":"15091","barcode":"7899248108653"},{"sku":"15094","barcode":"7909201024859","apelido":"LU1815004"},{"sku":"15095","barcode":"7899248171855"},{"sku":"15096","barcode":"7899248178144"},{"sku":"15098","apelido":"1101421"},{"sku":"15099","barcode":"7899248156203","apelido":"1101173"},{"sku":"15100","barcode":"7899248178120"},{"sku":"15101","barcode":"7899248102118"},{"sku":"15104","apelido":"1103426"},{"sku":"15105","apelido":"1103670"},{"sku":"15106","barcode":"7909201019480","apelido":"1104353"},{"sku":"15108","barcode":"7909201028871","apelido":"1104793"},{"sku":"15117","apelido":"1105189"},{"sku":"15118","barcode":"7909201024323"},{"sku":"15120","barcode":"7909201024392"},{"sku":"15137","barcode":"7899468022685","apelido":"5HP-12241-00"},{"sku":"15145","barcode":"7899468045110","apelido":"16700-KVS-GAS"},{"sku":"15148","barcode":"7899468090769"},{"sku":"15149","barcode":"7899468049989"},{"sku":"15150","barcode":"7899468003615"},{"sku":"15151","barcode":"7899468003684"},{"sku":"15155","barcode":"7908305603137"},{"sku":"15159","barcode":"7899468077685"},{"sku":"14192","barcode":"7890537115123","apelido":"50017786"},{"sku":"14439","barcode":"7890537115093","apelido":"50017783"},{"sku":"14813","barcode":"7892415478641","apelido":"VE0510129"},{"sku":"15182","barcode":"7898485614194"},{"sku":"15186","barcode":"7898558335827"},{"sku":"15194","barcode":"7899258706863","apelido":"60042NSE9"},{"sku":"15215","barcode":"7898558333380"},{"sku":"15216","barcode":"7898558339184"},{"sku":"15217","barcode":"7898558339207"},{"sku":"15218","barcode":"7898558339177"},{"sku":"15220","barcode":"7898558330372"},{"sku":"15221","barcode":"7898558335292"},{"sku":"15227","barcode":"7898508612084"},{"sku":"15228","barcode":"7898508610592"},{"sku":"15233","barcode":"7898485617591","apelido":"90285480"},{"sku":"15235","barcode":"7898485616303","apelido":"90285440"},{"sku":"15238","barcode":"7898508618079","apelido":"90285820"},{"sku":"15239","barcode":"7898485615696","apelido":"90285270"},{"sku":"15240","barcode":"7898485615320"},{"sku":"15244","barcode":"7899761403525","apelido":"90286110"},{"sku":"14797","barcode":"7894766665602","apelido":"VE0521674"},{"sku":"14807","barcode":"7892415557377","apelido":"VE0510196"},{"sku":"15258","barcode":"7898558331560"},{"sku":"15270","barcode":"609963656295","apelido":"VS01"},{"sku":"15277","barcode":"7899248182707"},{"sku":"15279","barcode":"7909201000358","apelido":"1103885"},{"sku":"15280","barcode":"7899248142749","apelido":"1103224"},{"sku":"15285","barcode":"7898558339511"},{"sku":"14235","barcode":"7890537128444","apelido":"50017474"},{"sku":"14808","barcode":"7892415478528","apelido":"VE0510030"},{"sku":"15292","barcode":"7898924047446"},{"sku":"15294","apelido":"91004-KRM-842"},{"sku":"15296","barcode":"7898558337265"},{"sku":"15297","barcode":"7898924047651"},{"sku":"14805","barcode":"7892415557391","apelido":"VE0510198"},{"sku":"15301","barcode":"7898558339474"},{"sku":"15302","barcode":"7898558331270"},{"sku":"15303","barcode":"7898558337432"},{"sku":"15307","barcode":"7898558334462"},{"sku":"15309","barcode":"7898558330426"},{"sku":"15311","barcode":"79080387400167","apelido":"63012RS"},{"sku":"15335","barcode":"7899128813394"},{"sku":"15373","barcode":"7898485612435"},{"sku":"15459","barcode":"7890018511642"},{"sku":"14806","barcode":"7892415974099","apelido":"VA0511478"},{"sku":"15535","barcode":"7899641867065","apelido":"VE05084000004"},{"sku":"15549","barcode":"7899468095153"},{"sku":"15552","barcode":"7898508614170"},{"sku":"15567","barcode":"7898508615306"},{"sku":"15615","barcode":"7898958192938"},{"sku":"15677","barcode":"27898421572889"},{"sku":"15698","barcode":"0606529978464","apelido":"VC13"},{"sku":"15719","barcode":"7899761407806","apelido":"90281570"},{"sku":"15756","barcode":"7899641815462"},{"sku":"16005","barcode":"7898420648536","apelido":"03-304"},{"sku":"16008","barcode":"7899613900936"},{"sku":"16009","barcode":"7894766684689"},{"sku":"16010","barcode":"0606529978518","apelido":"VC15"},{"sku":"16019","barcode":"7908189364766"},{"sku":"16023","barcode":"0609963656301","apelido":"VC16"},{"sku":"16959","apelido":"VC08"},{"sku":"16970","apelido":"VC20"},{"sku":"16972","apelido":"VC12"},{"sku":"16973","apelido":"VC12L"},{"sku":"16975","apelido":"ARCA"},{"sku":"14708","barcode":"7898485619250","apelido":"90213040"},{"sku":"14696","barcode":"7898485612350","apelido":"90226070"},{"sku":"14694","barcode":"7898485612398","apelido":"90226110"},{"sku":"90235010","barcode":"7898485619625"},{"sku":"16982","barcode":"7898508616747"},{"sku":"90237090","barcode":"7898508616747"},{"sku":"14356","barcode":"7899093600814"},{"sku":"16981","barcode":"7899761409015"},{"sku":"90250680","barcode":"7898485615641"},{"sku":"16984","barcode":"7899761408193","apelido":"90264040"},{"sku":"90264100","barcode":"7898485618307"},{"sku":"90264130","barcode":"7898485619236"},{"sku":"16985","barcode":"7898508611681","apelido":"90264210"},{"sku":"16983","barcode":"7898485619502","apelido":"90264540"},{"sku":"16986","barcode":"7898485619519","apelido":"90264550"},{"sku":"16980","barcode":"7898508614613","apelido":"90264580"},{"sku":"90264590","barcode":"7898508614576,7908180603123","apelido":"90264590"},{"sku":"14721","barcode":"7898485614842","apelido":"90278010"},{"sku":"90285210","barcode":"7898485615610,7908180600801"},{"sku":"90295080","barcode":"7899761409664"},{"sku":"14524","apelido":"91004-KRE-G01"},{"sku":"14811","barcode":"7892415478689","apelido":"VE0510133"}];

  const INDEX_URL = '/api/sku/index-single';
  const DETAIL_URL = '/api/sku/detail-single';
  const EDIT_URL = '/api/sku/single-edit';
  const SCAN_CONCURRENCY = 6;
  const APPLY_CONCURRENCY = 3;

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

  // /api/sku/detail-single não aceita {sku} sozinho de forma confiável (testado
  // ao vivo: 513/513 vieram "não encontrado") — precisa do idStr real. A única
  // fonte confirmada de idStr por SKU é a varredura paginada do catálogo
  // inteiro (/api/sku/index-single, a mesma que canva_sync já usa), então
  // busca o catálogo todo uma vez e monta um mapa SKU normalizado -> idStr
  // antes de tentar qualquer detail-single.
  async function fetchCatalogIdMap(onProgress) {
    const map = new Map();
    const pageSize = 300;
    let pageNum = 1;
    for (;;) {
      const res = await fetch(INDEX_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageNum, pageSize, sortName: '0', sortValue: '0', searchGroup: 1 }),
      });
      if (!res.ok) throw new Error(`index-single HTTP ${res.status}`);
      const json = await res.json();
      console.log('[KZR] index-single página', pageNum, json);
      if (json.code !== 0) throw new Error(json.msg || 'index-single falhou');
      const data = json.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      for (const item of list) {
        const key = normSku(item.sku);
        if (key && !map.has(key)) map.set(key, String(item.idStr ?? item.id));
      }
      const total = Number(data.total || 0);
      console.log(`[KZR] página ${pageNum}: ${list.length} item(ns), mapa acumulado: ${map.size}, total do catálogo: ${total}`);
      onProgress?.(map.size, total);
      if (!list.length || pageNum * pageSize >= total) break;
      pageNum++;
    }
    console.log('[KZR] catálogo carregado — SKUs mapeados:', map.size);
    console.log('[KZR] amostra de chaves no mapa:', [...map.keys()].slice(0, 25));
    console.log('[KZR] mapa tem "14089"?', map.get('14089'));
    console.log('[KZR] mapa tem "14090"?', map.get('14090'));
    if (map.size === 0) {
      throw new Error('index-single retornou 0 produtos — abra o Console (F12) e veja os logs [KZR] pra entender o motivo antes de tentar de novo.');
    }
    return map;
  }

  let detailDebugLogged = false;

  async function fetchDetailById(idStr) {
    // checkout.js tenta {idStr} e depois {id} em sequência (a mesma chamada
    // aceita as duas formas dependendo da versão do endpoint) — replica isso
    // aqui em vez de assumir que só uma funciona.
    for (const payload of [{ idStr: String(idStr) }, { id: String(idStr) }]) {
      try {
        const res = await fetch(DETAIL_URL, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);
        if (!detailDebugLogged) {
          detailDebugLogged = true;
          console.log('[KZR] exemplo de resposta detail-single', payload, 'status HTTP:', res.status, json);
        }
        if (!res.ok) continue;
        if (!json || json.code !== 0 || !json.data) continue;
        return json.data;
      } catch (e) {
        if (!detailDebugLogged) {
          detailDebugLogged = true;
          console.log('[KZR] erro de rede em detail-single', payload, e);
        }
      }
    }
    return null;
  }

  async function applySingleEdit(current, overrides) {
    const payload = {
      id: String(current.idStr ?? current.id),
      currency: current.currency,
      priceUnit: current.priceUnit,
      taxGroupId: current.taxGroupId,
      taxNcm: current.taxNcm,
      averageCostDataPermission: current.averageCostDataPermission,
      barcode: overrides.barcode ?? current.barcode,
      gtinCode: current.gtinCode ?? null,
      brand: current.brand,
      catalogId: current.catalogId,
      commodityHeight: current.commodityHeight,
      commodityLength: current.commodityLength,
      commodityWeight: current.commodityWeight,
      commodityWidth: current.commodityWidth,
      costPrice: current.costPrice,
      description: current.description,
      imgUrl: current.imgUrl,
      isInvoice: current.isInvoice,
      referencePrice: current.referencePrice,
      releaseDate: current.releaseDate,
      saleStatus: String(current.saleStatus ?? '0'),
      salesmanId: current.salesmanId,
      sizeChart: current.sizeChart ?? '',
      sku: current.sku,
      skuAliasList: overrides.skuAliasList ?? (current.skuAliasList || []),
      skuRelations: current.skuRelations || [],
      skuSupplierRelations: current.skuSupplierRelations || [],
      supplierLink: current.supplierLink ?? '',
      supplierLinkList: [{ value: '' }],
      taxCest: current.taxCest,
      taxOrigin: current.taxOrigin,
      taxUnit: current.taxUnit,
      title: current.title,
      titleAlias: current.titleAlias ?? '',
      videoUrl: current.videoUrl ?? '',
    };
    const res = await fetch(EDIT_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json().catch(() => null);
    if (!json || json.code !== 0) throw new Error(json?.msg || 'erro desconhecido');
  }

  function buildAliasEntry(template, value) {
    if (Array.isArray(template) && template.length && typeof template[0] === 'object') {
      const shape = { ...template[0] };
      for (const key of Object.keys(shape)) {
        if (/alias/i.test(key)) shape[key] = value;
        else if (/id/i.test(key)) shape[key] = null;
      }
      return [shape];
    }
    return [value];
  }

  function injectStyles() {
    if (document.getElementById('kzr-style')) return;
    const s = document.createElement('style');
    s.id = 'kzr-style';
    s.textContent = `
      #kzr-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:0;border-radius:10px;background:#b42318;color:#fff;padding:10px 14px;font:700 12px Arial;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}
      .kzr-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(16,24,40,.6);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif}
      .kzr-modal{width:min(720px,96vw);max-height:88vh;background:#fff;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
      .kzr-head{padding:16px 18px;border-bottom:1px solid #eee;font-size:15px;font-weight:800}
      .kzr-body{padding:16px 18px;overflow:auto;font-size:12px;color:#333;line-height:1.6}
      .kzr-foot{padding:12px 18px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px}
      .kzr-btn2{height:36px;border:0;border-radius:8px;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer}
      .kzr-btn2.primary{background:#b42318;color:#fff}
      .kzr-btn2.secondary{background:#eee;color:#333}
      .kzr-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
      .kzr-stat{background:#f7f7f8;border-radius:8px;padding:8px;text-align:center}
      .kzr-stat b{display:block;font-size:18px}
      .kzr-stat span{font-size:9px;color:#667085}
      .kzr-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
      .kzr-table th,.kzr-table td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left}
      .kzr-log{font-family:monospace;font-size:10px;background:#111;color:#0f0;padding:8px;border-radius:8px;max-height:220px;overflow:auto;margin-top:10px;white-space:pre-wrap}
      .kzr-warn{background:#fff7e6;border:1px solid #ffe7ba;border-radius:8px;padding:8px;margin-top:8px;color:#9b6500}
    `;
    document.head.appendChild(s);
  }

  function createButton() {
    if (document.getElementById('kzr-btn')) return;
    const b = document.createElement('button');
    b.id = 'kzr-btn';
    b.textContent = 'Restaurar EAN/Apelido';
    b.onclick = runRecovery;
    document.body.appendChild(b);
  }

  function modal(html) {
    document.getElementById('kzr-modal-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'kzr-modal-backdrop';
    backdrop.className = 'kzr-backdrop';
    backdrop.innerHTML = `<div class="kzr-modal">${html}</div>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  async function runRecovery() {
    const btn = document.getElementById('kzr-btn');
    btn.disabled = true;
    btn.textContent = 'Lendo catálogo do UpSeller...';

    let idMap;
    try {
      idMap = await fetchCatalogIdMap((found, total) => {
        btn.textContent = `Lendo catálogo... ${found}/${total || '?'}`;
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Restaurar EAN/Apelido';
      alert(`Falha ao ler o catálogo do UpSeller: ${e.message || e}`);
      return;
    }

    btn.textContent = `Varrendo 0/${RECOVERY_DATA.length}...`;
    let scanned = 0;
    let aliasTemplate = null;

    const results = await mapWithConcurrency(RECOVERY_DATA, SCAN_CONCURRENCY, async (entry) => {
      const idStr = idMap.get(normSku(entry.sku));
      if (!idStr) {
        scanned++;
        btn.textContent = `Varrendo ${scanned}/${RECOVERY_DATA.length}...`;
        return { entry, detail: null, status: 'not_found' };
      }

      const detail = await fetchDetailById(idStr);
      scanned++;
      btn.textContent = `Varrendo ${scanned}/${RECOVERY_DATA.length}...`;
      if (!detail) return { entry, detail: null, status: 'not_found' };

      if (!aliasTemplate && Array.isArray(detail.skuAliasList) && detail.skuAliasList.length) {
        aliasTemplate = detail.skuAliasList;
      }

      const needsBarcode = !!entry.barcode && !detail.barcode;
      const needsApelido = !!entry.apelido && (!Array.isArray(detail.skuAliasList) || !detail.skuAliasList.length);
      if (!needsBarcode && !needsApelido) return { entry, detail, status: 'already_ok' };
      return { entry, detail, status: 'needs_fix', needsBarcode, needsApelido };
    });

    btn.disabled = false;
    btn.textContent = 'Restaurar EAN/Apelido';

    const notFound = results.filter(r => r.status === 'not_found');
    const alreadyOk = results.filter(r => r.status === 'already_ok');
    const needsFix = results.filter(r => r.status === 'needs_fix');
    const needsApelidoCount = needsFix.filter(r => r.needsApelido).length;
    const willFixApelido = !!aliasTemplate;

    const fullList = needsFix.map(r => `
      <tr>
        <td>${esc(r.entry.sku)}</td>
        <td>${r.needsBarcode ? `<b>${esc(r.entry.barcode)}</b>` : (esc(r.detail.barcode) || '-')}</td>
        <td>${r.needsApelido && willFixApelido ? `<b>${esc(r.entry.apelido)}</b>` : (r.needsApelido ? 'pulado (sem molde)' : '-')}</td>
      </tr>
    `).join('');

    const backdrop = modal(`
      <div class="kzr-head">Restaurar EAN/Apelido — confirmação</div>
      <div class="kzr-body">
        <div class="kzr-stats">
          <div class="kzr-stat"><b>${RECOVERY_DATA.length}</b><span>SKUs na planilha</span></div>
          <div class="kzr-stat"><b>${notFound.length}</b><span>não achados no UpSeller</span></div>
          <div class="kzr-stat"><b>${alreadyOk.length}</b><span>já estão OK</span></div>
          <div class="kzr-stat"><b>${needsFix.length}</b><span>serão corrigidos</span></div>
        </div>
        ${!willFixApelido && needsApelidoCount ? `<div class="kzr-warn">${needsApelidoCount} produto(s) também precisam de apelido restaurado, mas nenhum produto vivo na varredura tinha esse campo preenchido pra eu copiar o formato certo — apelido NÃO será tocado nessa rodada, só o código de barras. Me avisa se algum SKU específico tiver o apelido visível no UpSeller pra eu usar de molde.</div>` : ''}
        <p>Todos os ${needsFix.length} que vão ser alterados (negrito = valor novo que será gravado):</p>
        <div style="max-height:260px;overflow:auto"><table class="kzr-table"><thead><tr><th>SKU</th><th>Código de barras</th><th>Apelido de SKU</th></tr></thead><tbody>${fullList}</tbody></table></div>
        <p style="margin-top:10px">Isso vai chamar <code>/api/sku/single-edit</code> pra cada um dos ${needsFix.length} produtos, mantendo todo o resto do cadastro igual (foto, preço, título etc. não mudam).</p>
      </div>
      <div class="kzr-foot">
        <button class="kzr-btn2 secondary" id="kzr-cancel">Cancelar</button>
        <button class="kzr-btn2 primary" id="kzr-confirm" ${needsFix.length ? '' : 'disabled'}>Confirmar e restaurar ${needsFix.length} produto(s)</button>
      </div>
    `);
    backdrop.querySelector('#kzr-cancel').onclick = () => backdrop.remove();
    backdrop.querySelector('#kzr-confirm').onclick = () => applyFixes(needsFix, aliasTemplate, backdrop);
  }

  async function applyFixes(needsFix, aliasTemplate, backdrop) {
    const body = backdrop.querySelector('.kzr-body');
    body.innerHTML += `<div class="kzr-log" id="kzr-log">Aplicando...\n</div>`;
    backdrop.querySelector('.kzr-foot').innerHTML = '';
    const log = backdrop.querySelector('#kzr-log');
    const append = (line) => { log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; };

    let ok = 0, fail = 0;
    await mapWithConcurrency(needsFix, APPLY_CONCURRENCY, async (item) => {
      const overrides = {};
      if (item.needsBarcode) overrides.barcode = item.entry.barcode;
      if (item.needsApelido && aliasTemplate) overrides.skuAliasList = buildAliasEntry(aliasTemplate, item.entry.apelido);
      try {
        await applySingleEdit(item.detail, overrides);
        ok++;
        append(`OK   ${item.entry.sku}`);
      } catch (e) {
        fail++;
        append(`FALHA ${item.entry.sku}: ${e.message || e}`);
      }
    });

    append(`\nConcluído: ${ok} restaurado(s), ${fail} falha(s).`);
    const foot = backdrop.querySelector('.kzr-foot');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'kzr-btn2 primary';
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
