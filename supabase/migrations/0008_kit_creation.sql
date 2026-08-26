-- "Criar" module: kit/composição creation tool, porting the standalone React
-- app the user had before (CriarComposicaoPage.tsx) into a Tampermonkey
-- module instead. All config (SPU -> product name, SPU+keyword -> suffix
-- "map modelos", sizes, the K-number sequence, the XLSX import template) is
-- shared across every computer via Supabase — deliberately NOT per-computer
-- local storage — because the K-number sequence must never duplicate across
-- two people creating kits on different computers at the same time. Same
-- class of race condition already found and fixed today in create-design
-- for Canva designs; kit_next_sequence() below is built to be safe from the
-- start instead of needing the same lesson twice.

create table if not exists kit_sizes (
  id uuid primary key default gen_random_uuid(),
  cliente text not null default 'POLLIANA',
  name text not null,
  code text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists kit_spu_products (
  id uuid primary key default gen_random_uuid(),
  cliente text not null default 'POLLIANA',
  spu text not null,
  product_name text not null default '',
  created_at timestamptz not null default now(),
  unique (cliente, spu)
);

create table if not exists kit_spu_suffixes (
  id uuid primary key default gen_random_uuid(),
  cliente text not null default 'POLLIANA',
  spu text not null, -- '*' = universal wildcard, applies when no SPU-specific match
  keyword text not null,
  suffix text not null,
  created_at timestamptz not null default now()
);

-- One row per cliente. last_k_number is only ever bumped via
-- kit_next_sequence() below — never a read-in-app-code-then-write, which is
-- exactly the race that let create-design duplicate a Canva design earlier
-- today. A single UPDATE (or upsert) is atomic under Postgres's own
-- row-level locking.
create table if not exists kit_sequence (
  cliente text primary key default 'POLLIANA',
  last_k_number int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists kit_template (
  cliente text primary key default 'POLLIANA',
  template_url text,
  storage_path text,
  updated_at timestamptz not null default now()
);

create or replace function kit_next_sequence(p_cliente text)
returns int as $$
declare
  next_number int;
begin
  insert into kit_sequence (cliente, last_k_number)
  values (p_cliente, 1)
  on conflict (cliente) do update
    set last_k_number = kit_sequence.last_k_number + 1,
        updated_at = now()
  returning last_k_number into next_number;
  return next_number;
end;
$$ language plpgsql;

create index if not exists kit_sizes_cliente_idx on kit_sizes (cliente, sort_order);
create index if not exists kit_spu_products_cliente_idx on kit_spu_products (cliente);
create index if not exists kit_spu_suffixes_cliente_idx on kit_spu_suffixes (cliente);

-- Same posture as every other table in this project: only ever touched by
-- Edge Functions (service_role) — never directly by the Tampermonkey agent
-- or any browser client.
alter table kit_sizes enable row level security;
alter table kit_spu_products enable row level security;
alter table kit_spu_suffixes enable row level security;
alter table kit_sequence enable row level security;
alter table kit_template enable row level security;
