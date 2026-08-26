-- Temporary storage for the OAuth PKCE code_verifier between
-- canva-oauth-start (which creates it) and canva-oauth-callback
-- (which consumes and deletes it). Rows are short-lived (minutes).

create table if not exists canva_oauth_pending (
  state text primary key,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

alter table canva_oauth_pending enable row level security;
