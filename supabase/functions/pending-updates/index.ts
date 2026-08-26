// Polled by the Tampermonkey agent alongside its normal discovery scan.
// Returns queued Canva->UpSeller updates for the caller's (loja, cliente)
// so the agent — which holds the live UpSeller session cookie the backend
// doesn't have — can apply them.

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

  let body: { loja?: string; cliente?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!body.loja || !body.cliente) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("pending_upseller_updates")
    .select("id, sku, image_urls")
    .eq("status", "pending")
    .eq("loja", body.loja)
    .eq("cliente", body.cliente)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return jsonResponse({ error: "db_fetch_failed", message: error.message }, 500);
  }

  return jsonResponse({ pending: data }, 200);
});
