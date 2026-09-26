# Kryzer Checkout Multi — POC

Prova de conceito para múltiplas sessões UpSeller simultâneas no mesmo aplicativo.

## O que esta versão testa

- 3 sessões UpSeller independentes;
- cada sessão usa um `data_directory` WebView2 próprio;
- o login de uma conta não substitui cookies das outras;
- coletores ficam escondidos depois de autenticados;
- cada coletor consulta `/api/order/index` na sua própria sessão;
- a central recebe snapshots por eventos Tauri;
- pedidos de todas as contas aparecem em uma lista única;
- filtro por conta e contagens Item Único / Múltiplos.

## O que ainda NÃO está ligado nesta POC

A impressão, bipagem e marcação `mark-print` unificadas ainda não são executadas pela central. Primeiro validamos que as sessões permanecem independentes e que os pedidos das três contas aparecem juntos sem vazamento de sessão.

## Teste

1. Abra `Kryzer-Checkout-Multi.exe`.
2. Clique **Conectar conta** no Slot 1 e faça login em uma conta UpSeller.
3. Após validar a sessão, a janela esconde e os pedidos aparecem na central.
4. Repita no Slot 2 com outra conta.
5. Repita no Slot 3.
6. Confirme que as três ficam verdes ao mesmo tempo e que a lista central contém pedidos de todas.
