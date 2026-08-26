-- Kryzer Canva <-> UpSeller sync: initial schema
-- Run this once in Supabase Dashboard > SQL Editor > New query > paste > Run

create extension if not exists pgcrypto;

create table if not exists product_links (
  id uuid primary key default gen_random_uuid(),

  -- identity in UpSeller
  sku text not null,
  loja text not null default 'KRYZER',
  cliente text not null default 'POLLIANA',
  upseller_product_id text not null,   -- UpSeller's idStr, e.g. "2126524396086717"
  gtin_code text,                       -- UpSeller's gtinCode, e.g. "SY7116438"
  tipo text not null check (tipo in ('simples', 'kit', 'variante')),

  -- identity in Canva
  canva_design_id text,
  canva_updated_at timestamptz,

  -- sync state machine
  estado text not null default 'INICIALIZANDO' check (estado in ('INICIALIZANDO', 'CANVA_MESTRE')),
  last_export_hash text,               -- hash of the images last pushed Canva -> UpSeller, to skip no-op syncs
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (sku, loja, cliente)
);

create index if not exists product_links_estado_idx on product_links (estado);
create index if not exists product_links_canva_design_id_idx on product_links (canva_design_id);

create table if not exists canva_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  account_label text not null unique,  -- e.g. 'kryzer_polliana'
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists product_links_set_updated_at on product_links;
create trigger product_links_set_updated_at
  before update on product_links
  for each row execute function set_updated_at();

drop trigger if exists canva_oauth_tokens_set_updated_at on canva_oauth_tokens;
create trigger canva_oauth_tokens_set_updated_at
  before update on canva_oauth_tokens
  for each row execute function set_updated_at();

-- RLS: these tables are only ever touched by the Edge Functions using the
-- service_role key (which bypasses RLS), never directly by the Tampermonkey
-- script or any anon client. Lock them down completely.
alter table product_links enable row level security;
alter table canva_oauth_tokens enable row level security;
