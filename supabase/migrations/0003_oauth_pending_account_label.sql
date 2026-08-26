-- Multi-tenant support: canva-oauth-start now takes an ?account_label=
-- parameter identifying WHICH client is authorizing (one shared Canva
-- integration/app, one Canva OAuth token per client). Carry that through
-- the pending row so canva-oauth-callback knows which account_label to
-- save the resulting token under.

alter table canva_oauth_pending
  add column if not exists account_label text not null default 'kryzer_polliana';

alter table canva_oauth_pending
  alter column account_label drop default;
