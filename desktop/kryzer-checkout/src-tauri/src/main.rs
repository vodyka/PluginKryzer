use tauri::{WebviewUrl, WebviewWindowBuilder};

const UPSELLER_LOGIN: &str = "https://app.upseller.com/pt/login";
const UPSELLER_CHECKOUT: &str =
    "https://app.upseller.com/pt/order/in-process?kzCheckout=1&kzDesktop=1";

// O checkout atual entra compilado dentro do executável.
// No futuro, regras comerciais/licença podem sair daqui e ir para o backend Kryzer.
const CHECKOUT_SCRIPT: &str =
    include_str!("../../../../tampermonkey/src/modules/checkout.js");

fn desktop_bootstrap() -> String {
    let mut script = String::from(
        r#"
(() => {
  if (window.top !== window) return;
  if (window.location.hostname !== "app.upseller.com") return;

  // Compatibilidade com o checkout que hoje também roda como userscript.
  window.unsafeWindow = window;

  const checkoutUrl =
    "https://app.upseller.com/pt/order/in-process?kzCheckout=1&kzDesktop=1";
  const params = new URLSearchParams(window.location.search);
  const isCheckout =
    window.location.pathname === "/pt/order/in-process" &&
    params.get("kzCheckout") === "1";

  // Antes de entrar no checkout, usa a própria sessão do UpSeller para saber
  // se o usuário já autenticou. O app nunca lê nem armazena a senha.
  if (!isCheckout) {
    window.setTimeout(async () => {
      try {
        const response = await fetch("/api/home", { credentials: "include" });
        const json = await response.json();
        const user = json?.data?.user;
        const puid = user?.puid || user?.id;
        if (puid) window.location.replace(checkoutUrl);
      } catch (_) {
        // Continua na tela oficial do UpSeller até existir uma sessão válida.
      }
    }, 900);
    return;
  }

  if (window.__KRYZER_DESKTOP_CHECKOUT__) return;
  window.__KRYZER_DESKTOP_CHECKOUT__ = true;

  // Camada básica de endurecimento do protótipo.
  // Não é tratada como proteção absoluta contra engenharia reversa.
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  }, true);

  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const blocked =
      key === "f12" ||
      (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
      (event.ctrlKey && key === "u");

    if (blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
"#,
    );

    script.push_str(CHECKOUT_SCRIPT);
    script.push_str(
        r#"
})();
"#,
    );
    script
}

fn main() {
    let init_script = desktop_bootstrap();

    tauri::Builder::default()
        .setup(move |app| {
            let login_url = UPSELLER_LOGIN
                .parse()
                .expect("URL de login do UpSeller inválida");

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(login_url))
                .title("Kryzer Checkout")
                .maximized(true)
                .min_inner_size(1024.0, 720.0)
                .resizable(true)
                .devtools(false)
                .zoom_hotkeys_enabled(false)
                .initialization_script(init_script.clone())
                .on_navigation(|url| {
                    url.host_str()
                        .map(|host| host.eq_ignore_ascii_case("app.upseller.com"))
                        .unwrap_or(false)
                })
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o Kryzer Checkout");
}
