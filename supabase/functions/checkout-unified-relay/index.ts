import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED = new Map([
  ["30945", { name: "MASTER", role: "MASTER" }],
  ["34552", { name: "Moto Cintra", role: "CLIENT" }],
  ["33745", { name: "Giro X", role: "CLIENT" }],
]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-client-info",
  "Cache-Control": "no-store",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (body?.mode === "publish") {
    const puid = String(body.puid || "").trim();
    const config = ALLOWED.get(puid);
    if (!config) return json({ error: "puid_not_allowed" }, 403);

    const orders = Array.isArray(body.orders) ? body.orders.slice(0, 1000) : [];
    const { error } = await supabase
      .from("v2_checkout_unified_snapshots")
      .upsert({
        puid,
        account_name: config.name,
        role: config.role,
        orders,
        diagnostics: body.diagnostics ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "puid" });

    if (error) return json({ error: "db_publish_failed", message: error.message }, 500);
    return json({ ok: true, puid, received: orders.length, updatedAt: new Date().toISOString() });
  }

  if (body?.mode === "state") {
    const { data, error } = await supabase
      .from("v2_checkout_unified_snapshots")
      .select("puid,account_name,role,orders,diagnostics,updated_at")
      .in("puid", [...ALLOWED.keys()]);

    if (error) return json({ error: "db_state_failed", message: error.message }, 500);

    const now = Date.now();
    const byPuid = new Map((data || []).map((row: any) => [String(row.puid), row]));
    const sources = [...ALLOWED.entries()].map(([puid, config]) => {
      const row: any = byPuid.get(puid) || null;
      const updatedAt = row?.updated_at || null;
      const ageMs = updatedAt ? now - new Date(updatedAt).getTime() : Number.POSITIVE_INFINITY;
      return {
        puid,
        name: config.name,
        role: config.role,
        connected: ageMs <= 45000,
        stale: ageMs > 90000,
        updatedAt,
        transport: "cloud",
        orders: Array.isArray(row?.orders) ? row.orders : [],
        diagnostics: row?.diagnostics ?? null,
      };
    });

    return json({
      ok: true,
      type: "unified_state",
      generatedAt: new Date().toISOString(),
      sources,
    });
  }

  return json({ error: "unknown_mode" }, 400);
});
