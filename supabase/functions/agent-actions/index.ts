// Polled by the Tampermonkey bridge alongside its check-in. Returns
// pending fila_de_acoes rows this agent should execute: ones explicitly
// targeted at it (alvo_agent_id), or targeted at its papel
// (alvo_papel_id), or untargeted (any agent may pick up).

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

  let body: { deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!body.deviceId) {
    return jsonResponse({ error: "missing_device_id" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, papel_id")
    .eq("device_id", body.deviceId)
    .maybeSingle();

  if (agentError) {
    return jsonResponse({ error: "db_lookup_failed", message: agentError.message }, 500);
  }
  if (!agent || !agent.papel_id) {
    return jsonResponse({ actions: [] }, 200);
  }

  const { data, error } = await supabase
    .from("fila_de_acoes")
    .select("id, tipo, payload")
    .eq("status", "pending")
    .or(`alvo_agent_id.eq.${agent.id},alvo_agent_id.is.null`)
    .or(`alvo_papel_id.eq.${agent.papel_id},alvo_papel_id.is.null`)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return jsonResponse({ error: "db_fetch_failed", message: error.message }, 500);
  }

  return jsonResponse({ actions: data }, 200);
});
