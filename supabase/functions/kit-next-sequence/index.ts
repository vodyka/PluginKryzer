// Hands out the next K number, atomically, via the kit_next_sequence()
// Postgres function (migration 0008) — a single upsert under Postgres's own
// row locking, not a read-then-write from application code. Two computers
// generating a kit at the same moment will never get the same number.

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

  const { data, error } = await supabase.rpc("kit_next_sequence", { p_cliente: cliente });
  if (error) return jsonResponse({ error: "db_rpc_failed", message: error.message }, 500);

  return jsonResponse({ k_number: data }, 200);
});
