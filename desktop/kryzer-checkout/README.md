# Kryzer Checkout Desktop — Protótipo

Primeira prova de conceito do Checkout como aplicativo Windows, sem Tampermonkey.

## Fluxo

1. O aplicativo abre a tela oficial de login do UpSeller.
2. O cliente informa usuário/senha diretamente no UpSeller.
3. O app verifica apenas se a sessão autenticada existe usando `/api/home`.
4. Quando autenticado, redireciona para `/pt/order/in-process?kzCheckout=1`.
5. O `checkout.js` atual é injetado automaticamente e assume a tela inteira.
6. A sessão do WebView2 fica no perfil do aplicativo e tende a permanecer entre aberturas.

## Segurança desta POC

- sem Tampermonkey;
- DevTools desativado no WebView;
- navegação principal restrita a `app.upseller.com`;
- F12 / atalhos comuns de DevTools bloqueados no modo Checkout;
- o Checkout entra compilado dentro do executável.

Isto dificulta cópia casual, mas não é proteção absoluta. Para a versão comercial, a etapa seguinte é mover licença e regras sensíveis para o backend Kryzer.

## Gerar o EXE localmente

Requisitos no Windows:

- Rust stable;
- Microsoft WebView2 Runtime;
- Visual Studio Build Tools (C++).

Execute:

```powershell
cargo build --release --manifest-path desktop/kryzer-checkout/src-tauri/Cargo.toml
```

Saída:

`desktop/kryzer-checkout/src-tauri/target/release/kryzer-checkout.exe`

O workflow `Build Kryzer Checkout Desktop` gera o mesmo executável automaticamente no GitHub Actions.
