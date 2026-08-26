// Uploads the UpSeller-native XLSX kit-import template (multipart form,
// field "file") to the public "kit-templates" Storage bucket and records
// its URL for the cliente. Shared across the whole team — there's no
// per-user template distinction here (unlike the old standalone app, which
// was multi-tenant SaaS; Kryzer's internal team just needs one).

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "invalid_form_data" }, 400);
  }

  const cliente = String(form.get("cliente") || "POLLIANA");
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "missing_file" }, 400);
  }
  if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
    return jsonResponse({ error: "invalid_file_type" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const storagePath = `${cliente}/kit-template.xlsx`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("kit-templates")
    .upload(storagePath, bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (uploadError) return jsonResponse({ error: "upload_failed", message: uploadError.message }, 500);

  const { data: publicUrlData } = supabase.storage.from("kit-templates").getPublicUrl(storagePath);
  const templateUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { error: dbError } = await supabase
    .from("kit_template")
    .upsert({ cliente, template_url: templateUrl, storage_path: storagePath, updated_at: new Date().toISOString() });
  if (dbError) return jsonResponse({ error: "db_upsert_failed", message: dbError.message }, 500);

  return jsonResponse({ status: "ok", template_url: templateUrl }, 200);
});
