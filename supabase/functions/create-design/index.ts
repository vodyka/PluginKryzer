// Called once per UpSeller product by the Tampermonkey agent (task #7).
// loja+cliente are required (labeling/title only — Kryzer is an agency,
// every client's designs land in ONE shared central Canva account, see
// _shared/account-label.ts). Designs get filed into a per-client Canva
// folder ("Agencia - <CLIENTE>"), auto-created on first use.
// If the product already has a Canva link, it's a no-op (idempotent).
// Otherwise builds a 1200x1200-per-page PDF from the product's photos
// (0 photos -> 1 blank page; kit -> only its first component's photo)
// and imports it into Canva as a brand-new design, then records the link
// with estado="CANVA_MESTRE".

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getValidCanvaAccessToken } from "../_shared/canva-token.ts";
import { buildSquarePdf } from "../_shared/pdf.ts";
import { CANVA_ACCOUNT_LABEL } from "../_shared/account-label.ts";
import { getOrCreateClientFolder, moveDesignToFolder } from "../_shared/canva-folder.ts";

const IMPORTS_URL = "https://api.canva.com/rest/v1/imports";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 30;

interface SyncRequest {
  sku: string;
  upsellerProductId: string;
  gtinCode?: string | null;
  tipo: "simples" | "kit" | "variante";
  imgUrl?: string | null;
  kitFirstImgUrl?: string | null;
  loja: string;
  cliente: string;
}

function parsePhotoList(body: SyncRequest): string[] {
  if (body.tipo === "kit") {
    return body.kitFirstImgUrl ? [body.kitFirstImgUrl] : [];
  }
  if (!body.imgUrl) return [];
  return body.imgUrl.split("|").map((u) => u.trim()).filter(Boolean);
}

function base64(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function pollImportJob(jobId: string, accessToken: string): Promise<any> {
  const url = `${IMPORTS_URL}/${jobId}`;
  let consecutiveCheckFailures = 0;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    let res: Response;
    let json: unknown;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      json = await res.json();
    } catch (e) {
      res = undefined as unknown as Response;
      json = { networkError: String(e) };
    }

    // Transient hiccup checking status (network blip or a bare 5xx from
    // Canva's own API) — retry rather than treating it as the job itself
    // having failed. Only give up if this keeps happening.
    if (!res || !res.ok) {
      consecutiveCheckFailures += 1;
      if (consecutiveCheckFailures >= 5) {
        throw new Error(`Erro ao consultar import job (persistente): ${JSON.stringify(json)}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    consecutiveCheckFailures = 0;

    const body = json as { job: { status: string; error?: unknown } };
    if (body.job.status === "success") return body.job;
    if (body.job.status === "failed") {
      throw new Error(`Import falhou: ${JSON.stringify(body.job.error)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timeout esperando o import do design no Canva.");
}

Deno.serve(async (req) => {
  const sharedSecret = Deno.env.get("SYNC_SHARED_SECRET");
  if (sharedSecret && req.headers.get("x-kryzer-secret") !== sharedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: SyncRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!body.sku || !body.upsellerProductId || !body.tipo || !body.loja || !body.cliente) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }

  const loja = body.loja;
  const cliente = body.cliente;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: existing, error: lookupError } = await supabase
    .from("product_links")
    .select("id, canva_design_id, estado")
    .eq("sku", body.sku)
    .eq("loja", loja)
    .eq("cliente", cliente)
    .maybeSingle();

  if (lookupError) {
    return jsonResponse({ error: "db_lookup_failed", message: lookupError.message }, 500);
  }
  if (existing) {
    return jsonResponse(
      { status: "already_linked", canva_design_id: existing.canva_design_id, estado: existing.estado },
      200,
    );
  }

  // Reserve the slot BEFORE any of the slow Canva work (import can take up
  // to ~45s). The SELECT above only protects against a check-then-act race
  // in theory — two overlapping calls for the same SKU (e.g. two open tabs,
  // two computers both running canva_sync) can both pass it before either
  // has written a row, both go on to create a REAL design in Canva, and only
  // then collide on the unique(sku, loja, cliente) constraint at the final
  // insert — by which point one of the two Canva designs is already an
  // orphan duplicate that nothing points to. This happened for real (SKU
  // 521AC02, 2026-07-22). Inserting a placeholder row now, relying on that
  // same unique constraint, makes the race fail immediately and cheaply
  // instead of after burning a real Canva import.
  const { data: reserved, error: reserveError } = await supabase
    .from("product_links")
    .insert({
      sku: body.sku,
      loja,
      cliente,
      upseller_product_id: body.upsellerProductId,
      gtin_code: body.gtinCode ?? null,
      tipo: body.tipo,
      estado: "INICIALIZANDO",
    })
    .select("id")
    .single();

  if (reserveError) {
    if (reserveError.code === "23505") {
      const { data: nowExisting } = await supabase
        .from("product_links")
        .select("canva_design_id, estado")
        .eq("sku", body.sku)
        .eq("loja", loja)
        .eq("cliente", cliente)
        .maybeSingle();
      return jsonResponse(
        { status: "already_linked", canva_design_id: nowExisting?.canva_design_id ?? null, estado: nowExisting?.estado ?? "INICIALIZANDO" },
        200,
      );
    }
    return jsonResponse({ error: "db_reserve_failed", message: reserveError.message }, 500);
  }

  // From here on, any failure must release the reservation so a retry isn't
  // permanently blocked by a stuck INICIALIZANDO row with no real design.
  const releaseReservation = () => supabase.from("product_links").delete().eq("id", reserved.id);

  const photos = parsePhotoList(body);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildSquarePdf(photos);
  } catch (e) {
    await releaseReservation();
    return jsonResponse({ error: "pdf_build_failed", message: String(e) }, 500);
  }

  let accessToken: string;
  try {
    accessToken = await getValidCanvaAccessToken(supabase, CANVA_ACCOUNT_LABEL);
  } catch (e) {
    await releaseReservation();
    return jsonResponse({ error: "canva_token_failed", message: String(e) }, 500);
  }

  const title = `${body.sku}_${loja}_${cliente}`.slice(0, 50);

  const importRes = await fetch(IMPORTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Import-Metadata": JSON.stringify({
        title_base64: base64(title),
        mime_type: "application/pdf",
      }),
    },
    body: pdfBytes,
  });

  const importJson = await importRes.json();
  if (!importRes.ok) {
    await releaseReservation();
    return jsonResponse({ error: "import_start_failed", detail: importJson }, 502);
  }

  // deno-lint-ignore no-explicit-any
  let job: any;
  try {
    job = await pollImportJob(importJson.job.id, accessToken);
  } catch (e) {
    await releaseReservation();
    return jsonResponse({ error: "import_poll_failed", message: String(e) }, 502);
  }

  const design = job.result.designs[0];

  // The import job's own response only gives created_at, not updated_at —
  // and those two are NOT reliably identical (off by a second or so),
  // which made poll-canva-changes think every design had been edited the
  // moment it checked. Fetch the design directly to get the real baseline.
  let canvaUpdatedAt = new Date(design.created_at * 1000);
  try {
    const designRes = await fetch(`https://api.canva.com/rest/v1/designs/${design.id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const designJson = await designRes.json();
    if (designRes.ok) {
      canvaUpdatedAt = new Date(designJson.design.updated_at * 1000);
    }
  } catch {
    // fall back to created_at-derived value above
  }

  let folderWarning: string | null = null;
  try {
    const folderId = await getOrCreateClientFolder(supabase, accessToken, cliente);
    await moveDesignToFolder(accessToken, design.id, folderId);
  } catch (e) {
    // Non-fatal: the design itself was created successfully. Worst case it
    // just sits in the account's root Projects instead of the client
    // folder — better than losing/duplicating the design over a filing
    // failure.
    folderWarning = String(e);
    console.warn("[create-design] falha ao organizar em pasta:", folderWarning);
  }

  const { error: updateError } = await supabase
    .from("product_links")
    .update({
      canva_design_id: design.id,
      canva_updated_at: canvaUpdatedAt.toISOString(),
      estado: "CANVA_MESTRE",
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", reserved.id);

  if (updateError) {
    return jsonResponse({ error: "db_update_failed", message: updateError.message }, 500);
  }

  return jsonResponse(
    {
      status: "created",
      canva_design_id: design.id,
      pages: photos.length || 1,
      ...(folderWarning ? { folder_warning: folderWarning } : {}),
    },
    200,
  );
});
