#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const COLLECTOR_URL: &str =
    "https://app.upseller.com/pt/order/in-process?kzMultiCollector=1";

const CHECKOUT_SCRIPT: &str =
    include_str!("../../../../tampermonkey/src/modules/checkout.js");

fn collector_script(slot: u8) -> String {
    let mut script = format!(
        r#"
(() => {{
  if (window.top !== window) return;
  if (window.location.hostname !== "app.upseller.com") return;

  window.unsafeWindow = window;
  window.__KRYZER_MULTI_SLOT__ = {slot};
}})();
"#
    );

    // Cada sessão roda exatamente o mesmo motor do Checkout normal.
    // A janela fica escondida depois do login, mas continua classificando pedidos,
    // resolvendo kits, armazéns, aliases e conversando com o Print Plugin.
    script.push_str(CHECKOUT_SCRIPT);

    script.push_str(&format!(
        r#"
(() => {{
  if (window.top !== window) return;
  if (window.location.hostname !== "app.upseller.com") return;
  if (window.__KRYZER_MULTI_COLLECTOR__) return;
  window.__KRYZER_MULTI_COLLECTOR__ = true;

  const SLOT = {slot};
  const LABEL = "account-" + SLOT;
  const collectorUrl =
    "https://app.upseller.com/pt/order/in-process?kzMultiCollector=1&slot=" + SLOT;
  const loginUrl = "https://app.upseller.com/pt/login";
  const tauri = window.__TAURI__;

  const emitToMain = async (eventName, payload) => {{
    try {{
      await tauri?.event?.emitTo("main", eventName, {{
        slot: SLOT,
        label: LABEL,
        at: new Date().toISOString(),
        ...payload
      }});
    }} catch (_) {{}}
  }};

  const isApiSuccess = (json) => {{
    const code = json?.code ?? json?.status ?? json?.data?.code;
    return code === 0 || code === 200 || code === "0" || code === "200" ||
      json?.success === true || json?.ok === true ||
      json?.msg === "success" || json?.message === "success";
  }};

  async function validateSession() {{
    try {{
      const body = new URLSearchParams({{
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
      }});
      const response = await fetch("/api/order/index", {{
        method: "POST",
        credentials: "include",
        headers: {{ "content-type": "application/x-www-form-urlencoded" }},
        body: body.toString()
      }});
      const json = await response.json();
      const message = String(json?.msg || json?.message || "");
      return {{
        ok: response.ok && isApiSuccess(json),
        authFailed:
          message.toLowerCase().includes("validated.failed") ||
          message.toLowerCase().includes("login") ||
          response.status === 401 || response.status === 403,
        message
      }};
    }} catch (error) {{
      return {{
        ok: false,
        authFailed: false,
        message: String(error?.message || error || "Falha ao validar sessão.")
      }};
    }}
  }}

  async function accountMeta() {{
    try {{
      const response = await fetch("/api/home", {{ credentials: "include" }});
      const json = await response.json();
      const user = json?.data?.user || json?.user || {{}};
      return {{
        puid: String(user?.puid || user?.id || json?.data?.puid || ""),
        name: String(
          user?.companyName || user?.nickName || user?.nickname ||
          user?.userName || user?.username || user?.name || ""
        )
      }};
    }} catch (_) {{
      return {{ puid: "", name: "" }};
    }}
  }}

  async function bridgeReady(timeoutMs = 15000) {{
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {{
      const bridge = window.KZCheckoutRapido;
      if (bridge && typeof bridge.snapshotUnificado === "function") return bridge;
      await new Promise(resolve => setTimeout(resolve, 200));
    }}
    return null;
  }}

  let connectedOnce = false;
  let collecting = false;

  async function collectSnapshot(forceRefresh = false) {{
    if (collecting) return;
    collecting = true;
    try {{
      const validation = await validateSession();
      if (!validation.ok) {{
        await emitToMain("kryzer-account-snapshot", {{
          status: validation.authFailed ? "login_required" : "error",
          message: validation.message || "Sessão UpSeller inválida.",
          orders: []
        }});
        if (validation.authFailed && window.location.pathname !== "/pt/login") {{
          window.location.replace(loginUrl);
        }}
        return;
      }}

      const bridge = await bridgeReady();
      if (!bridge) throw new Error("Motor do Checkout ainda não ficou disponível.");

      if (forceRefresh && typeof bridge.atualizarPedidosUnificado === "function") {{
        await bridge.atualizarPedidosUnificado();
      }}

      const meta = await accountMeta();
      const allOrders = bridge.snapshotUnificado() || [];
      const orders = allOrders.filter(order =>
        order?.eligible === true &&
        ["single1","singleMany","multiple"].includes(String(order?.category || ""))
      );
      const checkoutStatus = typeof bridge.statusUnificado === "function"
        ? bridge.statusUnificado()
        : {{}};

      await emitToMain("kryzer-account-snapshot", {{
        status: "connected",
        puid: meta.puid,
        accountName: meta.name,
        orderCount: orders.length,
        orders,
        checkoutStatus
      }});

      if (!connectedOnce) {{
        connectedOnce = true;
        window.setTimeout(async () => {{
          try {{ await tauri?.window?.getCurrentWindow()?.hide(); }} catch (_) {{}}
        }}, 500);
      }}
    }} catch (error) {{
      await emitToMain("kryzer-account-snapshot", {{
        status: "error",
        message: String(error?.message || error || "Falha ao coletar pedidos."),
        orders: []
      }});
    }} finally {{
      collecting = false;
    }}
  }}

  async function handleAction(message) {{
    const requestId = String(message?.requestId || "");
    const action = String(message?.action || "");
    const payload = message?.payload || {{}};

    try {{
      const bridge = await bridgeReady();
      if (!bridge) throw new Error("Motor do Checkout indisponível nesta conta.");

      let result;
      if (action === "refresh") {{
        await bridge.atualizarPedidosUnificado();
        result = {{ ok: true }};
        window.setTimeout(() => collectSnapshot(false), 250);
      }} else if (action === "set_printer") {{
        result = {{
          ok: bridge.definirImpressoraUnificado(String(payload.printer || "")) === true
        }};
      }} else if (action === "print_orders") {{
        const printer = String(payload.printer || "");
        if (printer) bridge.definirImpressoraUnificado(printer);
        result = await bridge.imprimirPedidosUnificado(
          Array.isArray(payload.orderRefs)
            ? payload.orderRefs
            : (Array.isArray(payload.orderIds) ? payload.orderIds : []),
          String(payload.label || ""),
          payload.allowCustomerMessages === true
        );
        window.setTimeout(() => collectSnapshot(true), 350);
      }} else {{
        throw new Error("Ação multi-conta desconhecida: " + action);
      }}

      await emitToMain("kryzer-account-action-response", {{
        requestId,
        ok: true,
        result
      }});
    }} catch (error) {{
      await emitToMain("kryzer-account-action-response", {{
        requestId,
        ok: false,
        error: String(error?.message || error || "Falha na ação da conta.")
      }});
    }}
  }}

  try {{
    tauri?.event?.listen("kryzer-account-action", event => {{
      handleAction(event?.payload || {{}});
    }});
  }} catch (_) {{}}

  const params = new URLSearchParams(window.location.search);
  const isLogin = window.location.pathname === "/pt/login";
  const isCollector =
    window.location.pathname === "/pt/order/in-process" &&
    params.get("kzMultiCollector") === "1";

  if (isLogin) {{
    emitToMain("kryzer-account-snapshot", {{
      status: "login_required",
      message: "Faça login nesta conta.",
      orders: []
    }});

    const checkLogin = async () => {{
      const validation = await validateSession();
      if (validation.ok) window.location.replace(collectorUrl);
    }};
    window.setTimeout(checkLogin, 800);
    window.setInterval(checkLogin, 1500);
    return;
  }}

  if (!isCollector) {{
    window.location.replace(collectorUrl);
    return;
  }}

  window.setTimeout(() => collectSnapshot(true), 1800);
  window.setInterval(() => collectSnapshot(false), 6500);
}})();
"#
    ));

    script
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Kryzer Checkout Multi")
            .maximized(true)
            .min_inner_size(1100.0, 720.0)
            .resizable(true)
            .devtools(false)
            .zoom_hotkeys_enabled(false)
            .build()?;

            let base_data_dir = app.path().app_data_dir()?.join("accounts");

            for slot in 1u8..=3u8 {
                let label = format!("account-{}", slot);
                let url = format!("{}&slot={}", COLLECTOR_URL, slot)
                    .parse()
                    .expect("URL do coletor UpSeller inválida");
                let data_dir = base_data_dir.join(format!("slot-{}", slot));

                WebviewWindowBuilder::new(
                    app,
                    label,
                    WebviewUrl::External(url),
                )
                .title(format!("UpSeller — Conta {}", slot))
                .inner_size(1280.0, 840.0)
                .min_inner_size(980.0, 680.0)
                .resizable(true)
                .visible(false)
                .devtools(false)
                .zoom_hotkeys_enabled(false)
                .data_directory(data_dir)
                .initialization_script(collector_script(slot))
                .on_navigation(|url| {
                    url.host_str()
                        .map(|host| host.eq_ignore_ascii_case("app.upseller.com"))
                        .unwrap_or(false)
                })
                .build()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o Kryzer Checkout Multi");
}
