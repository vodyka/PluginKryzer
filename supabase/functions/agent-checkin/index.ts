// Called by the thin Tampermonkey bridge script on every page load. Sends
// its self-generated device_id (+ whatever UpSeller puid it's currently
// logged in as, informational only). If the device_id has never been
// seen, creates an "unassigned" agent row (papel_id: null) — it'll show
// up in the admin panel for the admin to assign a papel (role) to.
// Always returns the agent's current papel + which modules are enabled,
// so the bridge script knows what to activate on this load.

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

  let body: { deviceId?: string; puid?: string | number };
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

  const { data: existing, error: lookupError } = await supabase
    .from("agents")
    .select("id, nome, papel_id, papeis(nome, modulos)")
    .eq("device_id", body.deviceId)
    .maybeSingle();

  if (lookupError) {
    return jsonResponse({ error: "db_lookup_failed", message: lookupError.message }, 500);
  }

  if (!existing) {
    const { data: created, error: insertError } = await supabase
      .from("agents")
      .insert({
        device_id: body.deviceId,
        upseller_puid: body.puid ? String(body.puid) : null,
        last_checkin_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      return jsonResponse({ error: "db_insert_failed", message: insertError.message }, 500);
    }

    return jsonResponse(
      { agentId: created.id, papel: null, modulos: [], status: "unassigned" },
      200,
    );
  }

  await supabase
    .from("agents")
    .update({
      last_checkin_at: new Date().toISOString(),
      upseller_puid: body.puid ? String(body.puid) : null,
    })
    .eq("id", existing.id);

  // deno-lint-ignore no-explicit-any
  const papel = existing.papeis as any;

  return jsonResponse(
    {
      agentId: existing.id,
      nome: existing.nome,
      papel: papel?.nome ?? null,
      modulos: papel?.modulos ?? [],
      status: papel ? "assigned" : "unassigned",
    },
    200,
  );
});
