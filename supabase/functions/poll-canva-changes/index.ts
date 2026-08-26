// Invoked on a schedule (Supabase Cron, ~every 3 min — see the pg_cron job
// set up in migration 0006). Checks a rotating batch of CANVA_MESTRE
// product_links for a design.updated_at change, and for each changed one:
// exports its pages as PNG from Canva and queues a pending_upseller_updates
// row. Does NOT talk to UpSeller directly (no session cookie available
// server-side) — the Tampermonkey agent applies queued updates using its
// live browser session (see pending-updates + ack-update functions).
//
// Kit products are skipped for now: the write-back shape for a kit's
// per-component photo hasn't been captured/confirmed yet (only "simples"
// and "variante" single-imgUrl updates are confirmed via a live capture
// of POST /api/sku/single-edit).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getValidCanvaAccessToken } from "../_shared/canva-token.ts";
import { CANVA_ACCOUNT_LABEL } from "../_shared/account-label.ts";
import { exportDesignPagesAsPng } from "../_shared/canva-export.ts";

const DESIGNS_URL = "https://api.canva.com/rest/v1/designs";
// Kept moderate: each export (when a design really changed) can itself
// take up to ~45s of polling, and the Edge Function has a ~150s idle
// timeout — a big batch with several real changes in it can blow through
// that. 20 made full-catalog rotation (~300 products) take up to ~45min
// per product in the worst case, too slow — 40 roughly halves that while
// staying safely under the timeout even if several in a batch changed.
const BATCH_SIZE = 40;
const INTER_ITEM_DELAY_MS = 400;

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  const sharedSecret = Deno.env.get("SYNC_SHARED_SECRET");
  if (sharedSecret && req.headers.get("x-kryzer-secret") !== sharedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let accessToken: string;
  try {
    accessToken = await getValidCanvaAccessToken(supabase, CANVA_ACCOUNT_LABEL);
  } catch (e) {
    return jsonResponse({ error: "canva_token_failed", message: String(e) }, 500);
  }

  const { data: links, error: fetchError } = await supabase
    .from("product_links")
    .select("id, sku, loja, cliente, tipo, canva_design_id, canva_updated_at")
    .eq("estado", "CANVA_MESTRE")
    .neq("tipo", "kit")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    return jsonResponse({ error: "db_fetch_failed", message: fetchError.message }, 500);
  }

  let checked = 0;
  let changed = 0;
  const skippedKit = 0;
  const errors: string[] = [];

  for (const link of links ?? []) {
    checked += 1;
    // Claim this row FIRST, before the slow Canva export work below — a batch
    // can take minutes (each real export ~up to 45s), long enough to overlap
    // the next ~3min cron tick. Bumping last_checked_at immediately narrows
    // that overlap window so a concurrent run's own SELECT (ordered oldest
    // last_checked_at first) doesn't re-grab the same rows and double-queue
    // the same product (this happened in practice during the first catch-up
    // sweep after the kit-rotation-stall fix above).
    await supabase
      .from("product_links")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", link.id);
    try {
      const res = await fetch(`${DESIGNS_URL}/${link.canva_design_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`get design failed: ${JSON.stringify(json)}`);

      const remoteUpdatedAt = new Date(json.design.updated_at * 1000);
      const storedUpdatedAt = link.canva_updated_at ? new Date(link.canva_updated_at) : null;
      const isChanged = !storedUpdatedAt || remoteUpdatedAt.getTime() !== storedUpdatedAt.getTime();

      if (isChanged) {
        const { data: existingPending } = await supabase
          .from("pending_upseller_updates")
          .select("id")
          .eq("product_link_id", link.id)
          .eq("status", "pending")
          .maybeSingle();

        if (existingPending) {
          // Already queued (e.g. a previous run got interrupted after
          // inserting but before updating canva_updated_at) — don't
          // export/queue a second time, just let the existing one apply.
          await supabase
            .from("product_links")
            .update({ canva_updated_at: remoteUpdatedAt.toISOString(), last_checked_at: new Date().toISOString() })
            .eq("id", link.id);
          changed += 1;
          await sleep(INTER_ITEM_DELAY_MS);
          continue;
        }

        const pageUrls = await exportDesignPagesAsPng(
          accessToken,
          link.canva_design_id,
          json.design.page_count,
        );

        const { error: insertError } = await supabase.from("pending_upseller_updates").insert({
          product_link_id: link.id,
          sku: link.sku,
          loja: link.loja,
          cliente: link.cliente,
          image_urls: pageUrls,
        });
        if (insertError) throw new Error(`insert pending failed: ${insertError.message}`);

        // IMPORTANT: re-fetch updated_at AFTER exporting, not before.
        // Exporting a design appears to bump Canva's own updated_at on it
        // (an activity/cache-touch side effect) — storing the pre-export
        // value here caused an infinite loop: every next poll saw a
        // "changed" design again (because Canva's real value had moved
        // past what we saved) and re-exported/re-queued it forever.
        let baselineUpdatedAt = remoteUpdatedAt;
        try {
          const postExportRes = await fetch(`${DESIGNS_URL}/${link.canva_design_id}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const postExportJson = await postExportRes.json();
          if (postExportRes.ok) {
            baselineUpdatedAt = new Date(postExportJson.design.updated_at * 1000);
          }
        } catch {
          // fall back to the pre-export value above
        }

        await supabase
          .from("product_links")
          .update({ canva_updated_at: baselineUpdatedAt.toISOString(), last_checked_at: new Date().toISOString() })
          .eq("id", link.id);

        changed += 1;
      } else {
        await supabase
          .from("product_links")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", link.id);
      }
    } catch (e) {
      errors.push(`${link.sku}: ${String(e)}`);
    }

    await sleep(INTER_ITEM_DELAY_MS);
  }

  return jsonResponse({ checked, changed, skippedKit, errors }, 200);
});
