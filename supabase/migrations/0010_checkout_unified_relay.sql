create table if not exists public.v2_checkout_unified_snapshots (
  puid text primary key,
  account_name text not null,
  role text not null check (role in ('MASTER','CLIENT')),
  orders jsonb not null default '[]'::jsonb,
  diagnostics jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists v2_checkout_unified_snapshots_updated_at_idx
  on public.v2_checkout_unified_snapshots(updated_at desc);

alter table public.v2_checkout_unified_snapshots enable row level security;

comment on table public.v2_checkout_unified_snapshots is
  'Relay temporario do Checkout Unificado Kryzer. Cada PUID publica apenas a propria fila; o MASTER le as tres fontes.';
