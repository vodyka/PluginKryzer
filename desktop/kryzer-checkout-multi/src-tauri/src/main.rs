#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const COLLECTOR_URL: &str =
    "https://app.upseller.com/pt/order/in-process?kzMultiCollector=1";

fn collector_script(slot: u8) -> String {
    let template = r#"
(() => {
  if (window.top !== window) return;
  if (window.location.hostname !== "app.upseller.com") return;
  if (window.__KRYZER_MULTI_COLLECTOR__) return;
  window.__KRYZER_MULTI_COLLECTOR__ = true;

  const SLOT = __SLOT__;
  const LABEL = "account-" + SLOT;
  const collectorUrl =
    "https://app.upseller.com/pt/order/in-process?kzMultiCollector=1&slot=" + SLOT;
  const loginUrl = "https://app.upseller.com/pt/login";

  const tauri = window.__TAURI__;
  const emitToMain = async (payload) => {
    try {
      await tauri?.event?.emitTo("main", "kryzer-account-snapshot", {
        slot: SLOT,
        label: LABEL,
        at: new Date().toISOString(),
        ...payload
      });
    } catch (_) {}
  };

  const isSuccess = (json) => {
    const code = json?.code ?? json?.status ?? json?.data?.code;
    return code === 0 || code === 200 || code === "0" || code === "200" ||
      json?.success === true || json?.ok === true ||
      json?.msg === "success" || json?.message === "success";
  };

  async function fetchOrderPage(pageNum) {
    const body = new URLSearchParams({
      timeType: "0",
      searchType: "0",
      searchValue: "",
      sortName: "1",
      sortValue: "0",
      orderState: "in_process",
      isVoided: "0",
      labelStatus: "success",
      pageNum: String(pageNum),
      pageSize: "300",
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
    if (!response.ok || !isSuccess(json)) {
      const message = String(json?.msg || json?.message || "validated.failed");
      const error = new Error(message);
      error.authFailed =
        message.toLowerCase().includes("validated.failed") ||
        message.toLowerCase().includes("login") ||
        response.status === 401 || response.status === 403;
      throw error;
    }

    const data = json?.data || {};
    return {
      list: Array.isArray(data.list) ? data.list : [],
      pages: Math.max(1, Number(data.pages || 1)),
      total: Number(data.total || 0)
    };
  }

  async function fetchAllOrders() {
    const first = await fetchOrderPage(1);
    const all = [...first.list];
    let page = 2;
    let pages = first.pages;
    while (page <= pages) {
      const next = await fetchOrderPage(page);
      all.push(...next.list);
      pages = Math.max(pages, next.pages || 1);
      if (!next.list.length) break;
      page += 1;
    }
    const map = new Map();
    for (const order of all) {
      const key = String(order?.idStr || order?.id || order?.orderNumber || "");
      if (key) map.set(key, order);
    }
    return [...map.values()];
  }

  async function accountMeta() {
    try {
      const response = await fetch("/api/home", { credentials: "include" });
      const json = await response.json();
      const user = json?.data?.user || json?.user || {};
      return {
        puid: String(user?.puid || user?.id || json?.data?.puid || ""),
        name: String(
          user?.companyName || user?.nickName || user?.nickname ||
          user?.userName || user?.username || user?.name || ""
        )
      };
    } catch (_) {
      return { puid: "", name: "" };
    }
  }

  function numberFrom(item, keys) {
    for (const key of keys) {
      const value = Number(item?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 1;
  }

  function normalizeOrder(order) {
    const items = Array.isArray(order?.orderItemList) ? order.orderItemList : [];
    const normalizedItems = items.map(item => ({
      sku: String(item?.variationSku || item?.productSku || item?.sku || item?.sellerSku || ""),
      title: String(item?.productName || item?.itemName || item?.title || ""),
      qty: numberFrom(item, ["goodsCount","productCount","qty","quantity","orderQty","count","productNum","skuQty","goodsQty"]),
      image: String(item?.image || item?.imageUrl || item?.productImage || "")
    })).filter(item => item.sku || item.title);

    const distinct = new Set(normalizedItems.map(item => item.sku || item.title).filter(Boolean));
    const totalQty = normalizedItems.reduce((sum, item) => sum + Number(item.qty || 1), 0) || 1;
    const distinctCount = Math.max(1, distinct.size || normalizedItems.length || 1);

    return {
      idStr: String(order?.idStr || order?.id || ""),
      authIdStr: String(order?.authIdStr || order?.authId || ""),
      orderNo: String(order?.orderNumber || order?.orderNo || order?.platformOrderNo || order?.idStr || ""),
      channel: String(order?.platform || order?.provider || order?.channel || order?.channelName || ""),
      shopName: String(order?.shopName || order?.storeName || order?.shop?.name || ""),
      warehouseId: String(order?.warehouseIdStr || order?.warehouseId || order?.warehouse?.id || ""),
      warehouseName: String(order?.warehouseName || order?.wareHouseName || order?.warehouse?.name || order?.warehouseIdStr || ""),
      deadlineAt: String(order?.orderTimeoutTimeStr || order?.orderTimeoutTime || order?.deadlineAt || ""),
      totalQty,
      distinctSkuCount: distinctCount,
      category: distinctCount > 1 ? "multiple" : (totalQty > 1 ? "singleMany" : "single1"),
      items: normalizedItems.slice(0, 12)
    };
  }

  let connectedOnce = false;
  let refreshing = false;

  async function collect() {
    if (refreshing) return;
    refreshing = true;
    try {
      const orders = await fetchAllOrders();
      const meta = await accountMeta();
      await emitToMain({
        status: "connected",
        puid: meta.puid,
        accountName: meta.name,
        orderCount: orders.length,
        orders: orders.map(normalizeOrder)
      });

      if (!connectedOnce) {
        connectedOnce = true;
        window.setTimeout(async () => {
          try { await tauri?.window?.getCurrentWindow()?.hide(); } catch (_) {}
        }, 650);
      }
    } catch (error) {
      const message = String(error?.message || error || "Falha ao consultar a conta.");
      await emitToMain({
        status: error?.authFailed ? "login_required" : "error",
        message,
        orders: []
      });

      if (error?.authFailed && window.location.pathname !== "/pt/login") {
        window.location.replace(loginUrl);
      }
    } finally {
      refreshing = false;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const isLogin = window.location.pathname === "/pt/login";
  const isCollector =
    window.location.pathname === "/pt/order/in-process" &&
    params.get("kzMultiCollector") === "1";

  if (isLogin) {
    emitToMain({ status: "login_required", message: "Faça login nesta conta." });

    const checkLogin = async () => {
      try {
        await fetchOrderPage(1);
        window.location.replace(collectorUrl);
      } catch (_) {}
    };
    window.setTimeout(checkLogin, 900);
    window.setInterval(checkLogin, 1600);
    return;
  }

  if (!isCollector) {
    window.location.replace(collectorUrl);
    return;
  }

  collect();
  window.setInterval(collect, 10000);
})();
"#;
    template.replace("__SLOT__", &slot.to_string())
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
                .inner_size(1200.0, 820.0)
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
