import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

// deno-lint-ignore no-explicit-any
export async function getValidCanvaAccessToken(supabase: any, accountLabel: string): Promise<string> {
  const { data: row, error } = await supabase
    .from("canva_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_label", accountLabel)
    .single();

  if (error || !row) {
    throw new Error(
      `Canva ainda não foi autorizado para "${accountLabel}" (sem token salvo em canva_oauth_tokens). ` +
        `Abra canva-oauth-start?account_label=${accountLabel} uma vez.`,
    );
  }

  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return row.access_token;
  }

  const clientId = Deno.env.get("CANVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET")!;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Falha ao renovar token do Canva (${accountLabel}): ${JSON.stringify(json)}`);
  }

  const newExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  await supabase
    .from("canva_oauth_tokens")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? row.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("account_label", accountLabel);

  return json.access_token;
}
