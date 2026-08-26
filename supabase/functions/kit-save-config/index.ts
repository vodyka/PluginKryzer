// Saves kit-creation config. Body: { cliente?, sizes?, spuProducts?,
// spuSuffixes? } — each section, if present, fully replaces that section's
// rows for the cliente (delete-then-insert, matching the old standalone
// app's PUT semantics: it always sent the complete list, never a diff).

import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface SizeInput { name: string; code: string; sort_order?: number }
interface ProductInput { spu: string; product_name: string }
interface SuffixInput { spu: string; keyword: string; suffix: string }

interface SaveRequest {
  cliente?: string;
  sizes?: SizeInput[];
  spuProducts?: ProductInput[];
  spuSuffixes?: SuffixInput[];
}

Deno.serve(async (req) => {
  const sharedSecret = Deno.env.get("SYNC_SHARED_SECRET");
  if (sharedSecret && req.headers.get("x-kryzer-secret") !== sharedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: SaveRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const cliente = body.cliente || "POLLIANA";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (Array.isArray(body.sizes)) {
    const { error: delError } = await supabase.from("kit_sizes").delete().eq("cliente", cliente);
    if (delError) return jsonResponse({ error: "db_delete_failed", message: delError.message }, 500);
    const rows = body.sizes
      .filter((s) => s.name && s.code)
      .map((s, i) => ({ cliente, name: s.name, code: s.code, sort_order: s.sort_order ?? i }));
    if (rows.length) {
      const { error: insError } = await supabase.from("kit_sizes").insert(rows);
      if (insError) return jsonResponse({ error: "db_insert_failed", message: insError.message }, 500);
    }
  }

  if (Array.isArray(body.spuProducts)) {
    const { error: delError } = await supabase.from("kit_spu_products").delete().eq("cliente", cliente);
    if (delError) return jsonResponse({ error: "db_delete_failed", message: delError.message }, 500);
    const rows = body.spuProducts
      .filter((p) => p.spu)
      .map((p) => ({ cliente, spu: p.spu, product_name: p.product_name || "" }));
    if (rows.length) {
      const { error: insError } = await supabase.from("kit_spu_products").insert(rows);
      if (insError) return jsonResponse({ error: "db_insert_failed", message: insError.message }, 500);
    }
  }

  if (Array.isArray(body.spuSuffixes)) {
    const { error: delError } = await supabase.from("kit_spu_suffixes").delete().eq("cliente", cliente);
    if (delError) return jsonResponse({ error: "db_delete_failed", message: delError.message }, 500);
    const rows = body.spuSuffixes
      .filter((s) => s.spu && s.keyword && s.suffix)
      .map((s) => ({ cliente, spu: s.spu, keyword: s.keyword, suffix: s.suffix }));
    if (rows.length) {
      const { error: insError } = await supabase.from("kit_spu_suffixes").insert(rows);
      if (insError) return jsonResponse({ error: "db_insert_failed", message: insError.message }, 500);
    }
  }

  return jsonResponse({ status: "ok" }, 200);
});
