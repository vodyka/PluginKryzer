// Called by the Tampermonkey agent after it applies (or fails to apply) a
// pending Canva->UpSeller update it got from pending-updates.

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

  let body: { id?: string; status?: "done" | "failed"; errorMessage?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!body.id || (body.status !== "done" && body.status !== "failed")) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error: updateError } = await supabase
    .from("pending_upseller_updates")
    .update({
      status: body.status,
      error_message: body.errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select("product_link_id")
    .single();

  if (updateError) {
    return jsonResponse({ error: "db_update_failed", message: updateError.message }, 500);
  }

  if (body.status === "done") {
    await supabase
      .from("product_links")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", row.product_link_id);
  }

  return jsonResponse({ status: "ok" }, 200);
});
