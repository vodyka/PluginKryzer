// Returns everything the "Criar" (kit creation) Tampermonkey module needs
// to render: sizes, SPU->product-name list, SPU+keyword->suffix map, the
// XLSX import template URL, and the current last K number (for display
// only — the real next number is only ever handed out by kit-next-sequence,
// never computed client-side).

import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const sharedSecret = Deno.env.get("SYNC_SHARED_SECRET");
  if (sharedSecret && req.headers.get("x-kryzer-secret") !== sharedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: { cliente?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const cliente = body.cliente || "POLLIANA";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [sizesRes, productsRes, suffixesRes, templateRes, sequenceRes] = await Promise.all([
    supabase.from("kit_sizes").select("id, name, code, sort_order").eq("cliente", cliente).order("sort_order"),
    supabase.from("kit_spu_products").select("id, spu, product_name").eq("cliente", cliente).order("spu"),
    supabase.from("kit_spu_suffixes").select("id, spu, keyword, suffix").eq("cliente", cliente).order("spu"),
    supabase.from("kit_template").select("template_url").eq("cliente", cliente).maybeSingle(),
    supabase.from("kit_sequence").select("last_k_number").eq("cliente", cliente).maybeSingle(),
  ]);

  for (const res of [sizesRes, productsRes, suffixesRes, templateRes, sequenceRes]) {
    if (res.error) return jsonResponse({ error: "db_error", message: res.error.message }, 500);
  }

  return jsonResponse({
    sizes: sizesRes.data ?? [],
    spuProducts: productsRes.data ?? [],
    spuSuffixes: suffixesRes.data ?? [],
    templateUrl: templateRes.data?.template_url ?? null,
    lastKNumber: sequenceRes.data?.last_k_number ?? 0,
  }, 200);
});
