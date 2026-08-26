// Canva redirects here after the user approves (or denies) the consent
// screen from canva-oauth-start. Exchanges the code for an access +
// refresh token (using PKCE, no user-facing secret exposure) and stores
// it in canva_oauth_tokens under whichever account_label was stashed by
// canva-oauth-start for this "state" (multi-client: one row per client).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { htmlResponse } from "../_shared/html.ts";

const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return htmlResponse(`Autorização negada pelo Canva: ${errorParam}`, 400);
  }
  if (!code || !state) {
    return htmlResponse("Faltando 'code' ou 'state' na resposta do Canva.", 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending, error: pendingError } = await supabase
    .from("canva_oauth_pending")
    .select("code_verifier, account_label")
    .eq("state", state)
    .single();

  if (pendingError || !pending) {
    return htmlResponse(
      "Sessão de autorização expirada ou inválida. Abra canva-oauth-start de novo.",
      400,
    );
  }

  const clientId = Deno.env.get("CANVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET")!;
  const redirectUri = Deno.env.get("CANVA_REDIRECT_URI")!;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const tokenRes = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: pending.code_verifier,
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = await tokenRes.json();

  await supabase.from("canva_oauth_pending").delete().eq("state", state);

  if (!tokenRes.ok) {
    return htmlResponse(
      `Erro ao trocar código por token: ${JSON.stringify(tokenJson)}`,
      500,
    );
  }

  const expiresAt = new Date(
    Date.now() + tokenJson.expires_in * 1000,
  ).toISOString();

  const { error: upsertError } = await supabase
    .from("canva_oauth_tokens")
    .upsert(
      {
        account_label: pending.account_label,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        expires_at: expiresAt,
      },
      { onConflict: "account_label" },
    );

  if (upsertError) {
    return htmlResponse(`Erro ao salvar token: ${upsertError.message}`, 500);
  }

  return htmlResponse(
    `Canva autorizado com sucesso para "${pending.account_label}"! Pode fechar esta aba.`,
    200,
  );
});
