// Visit this function's URL in a browser once to kick off the one-time
// Canva authorization for the single shared agency account (see
// _shared/account-label.ts — Kryzer is an agency, all clients' designs
// land in one central Canva account). Generates a PKCE pair, stashes the
// verifier in canva_oauth_pending keyed by a random state, and redirects
// the browser to Canva's consent screen.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { randomUrlSafeString, sha256Base64Url } from "../_shared/pkce.ts";
import { htmlResponse } from "../_shared/html.ts";
import { CANVA_ACCOUNT_LABEL } from "../_shared/account-label.ts";

const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const SCOPE =
  "design:content:read design:content:write design:meta:read asset:read asset:write folder:write";

Deno.serve(async (_req) => {
  const clientId = Deno.env.get("CANVA_CLIENT_ID");
  const redirectUri = Deno.env.get("CANVA_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    return htmlResponse(
      "Faltam as secrets CANVA_CLIENT_ID / CANVA_REDIRECT_URI no projeto Supabase.",
      500,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const codeVerifier = randomUrlSafeString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomUrlSafeString(24);

  const { error } = await supabase
    .from("canva_oauth_pending")
    .insert({ state, code_verifier: codeVerifier, account_label: CANVA_ACCOUNT_LABEL });

  if (error) {
    return htmlResponse(`Erro ao iniciar OAuth: ${error.message}`, 500);
  }

  const authUrl = new URL(CANVA_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
});
