// Removes the cliente's custom XLSX template — falls back to the module's
// built-in default headers (KIT_TEMPLATE_HEADERS in the Tampermonkey
// module) instead of a template file.

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

  const { data: existing } = await supabase
    .from("kit_template")
    .select("storage_path")
    .eq("cliente", cliente)
    .maybeSingle();

  if (existing?.storage_path) {
    await supabase.storage.from("kit-templates").remove([existing.storage_path]);
  }

  const { error } = await supabase.from("kit_template").delete().eq("cliente", cliente);
  if (error) return jsonResponse({ error: "db_delete_failed", message: error.message }, 500);

  return jsonResponse({ status: "ok" }, 200);
});
