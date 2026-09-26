#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

const UPSELLER_CHECKOUT: &str =
    "https://app.upseller.com/pt/order/in-process?kzCheckout=1&kzDesktop=1";

// O checkout atual entra compilado dentro do executável.
// No futuro, regras comerciais/licença podem sair daqui e ir para o backend Kryzer.
const CHECKOUT_SCRIPT: &str =
    include_str!("../../../../tampermonkey/src/modules/checkout.js");

fn desktop_bootstrap() -> String {
    let mut script = String::from(
        r#"
(async () => {
  if (window.top !== window) return;
  if (window.location.hostname !== "app.upseller.com") return;

  const checkoutUrl =
    "https://app.upseller.com/pt/order/in-process?kzCheckout=1&kzDesktop=1";
  const loginUrl = "https://app.upseller.com/pt/login";

  async function validateUpsellerSession() {
    try {
      const body = new URLSearchParams({
        timeType: "0",
        searchType: "0",
        searchValue: "",
        sortName: "1",
        sortValue: "0",
        orderState: "in_process",
        isVoided: "0",
        labelStatus: "success",
        pageNum: "1",
        pageSize: "1",
        warehouseType: "0",
        printCount: "0"
      });

      const response = await fetch("/api/order/index", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      const json = await response.json();
      const code = json?.code ?? json?.status ?? json?.data?.code;
      const ok =
        code === 0 || code === 200 || code === "0" || code === "200" ||
        json?.success === true || json?.ok === true ||
        json?.msg === "success" || json?.message === "success";

      return {
        ok,
        message: String(json?.msg || json?.message || "")
      };
    } catch (error) {
      return { ok: false, message: String(error?.message || error || "") };
    }
  }

  const params = new URLSearchParams(window.location.search);
  const isLogin = window.location.pathname === "/pt/login";
  const isCheckout =
    window.location.pathname === "/pt/order/in-process" &&
    params.get("kzCheckout") === "1";

  // Na tela de login, aguarda a própria sessão do UpSeller ficar válida.
  // Assim funciona mesmo se o login for uma SPA e não fizer reload completo.
  if (isLogin) {
    if (window.__KRYZER_LOGIN_WATCH__) return;
    window.__KRYZER_LOGIN_WATCH__ = true;

    const checkLogin = async () => {
      const validation = await validateUpsellerSession();
      if (validation.ok) {
        window.location.replace(checkoutUrl);
      }
    };

    window.setTimeout(checkLogin, 800);
    window.setInterval(checkLogin, 1500);
    return;
  }

  // Desktop dedicado: qualquer tela autenticada do UpSeller volta ao Checkout.
  if (!isCheckout) {
    window.location.replace(checkoutUrl);
    return;
  }

  // IMPORTANTE: a página do UpSeller pode renderizar mesmo sem uma sessão de API
  // válida. Só inicia o Kryzer depois que /api/order/index confirmar autenticação.
  const validation = await validateUpsellerSession();
  if (!validation.ok) {
    const message = validation.message.toLowerCase();
    if (message.includes("validated.failed") ||
        message.includes("login") ||
        message.includes("unauthorized") ||
        message.includes("session")) {
      window.location.replace(loginUrl);
      return;
    }

    // Na dúvida também pede login: é mais seguro do que abrir um Checkout vazio
    // parecendo autenticado.
    window.location.replace(loginUrl);
    return;
  }

  if (window.__KRYZER_DESKTOP_CHECKOUT__) return;
  window.__KRYZER_DESKTOP_CHECKOUT__ = true;

  // Compatibilidade com o checkout que hoje também roda como userscript.
  window.unsafeWindow = window;

  // Camada básica de endurecimento do protótipo.
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
            let checkout_url = UPSELLER_CHECKOUT
                .parse()
                .expect("URL do Checkout do UpSeller inválida");

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(checkout_url))
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
