-- GTIN/EAN-13 generation for the "Criar Variação" module — ported from the
-- user's old standalone app (worker/routes/gtin.ts). Algorithm confirmed
-- correct (standard GS1 EAN-13 check digit: odd positions counted from the
-- left weight 1, even positions weight 3), not reinvented.
--
-- GTIN = "789" (Brazil GS1 prefix) + 5-digit CNPJ prefix + 4-digit
-- zero-padded sequence + 1 check digit. The sequence must never repeat for
-- a given (cliente, cnpj5) pair — reserved via an atomic range-bump RPC,
-- same reasoning as kit_next_sequence in migration 0008: two computers
-- generating GTINs for the same CNPJ at the same time must never collide.

create table if not exists gtin_sequence (
  cliente text not null default 'POLLIANA',
  cnpj5 text not null,
  last_sequence int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (cliente, cnpj5)
);

create table if not exists gtin_codes (
  id uuid primary key default gen_random_uuid(),
  cliente text not null default 'POLLIANA',
  cnpj5 text not null,
  sequence_number int not null,
  gtin text not null,
  spu text not null default '',
  sku text not null default '',
  product_name text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists gtin_codes_cliente_idx on gtin_codes (cliente, created_at desc);
create index if not exists gtin_codes_search_idx on gtin_codes (cliente, spu, sku, gtin);

-- Atomically reserves a contiguous block of p_count sequence numbers for
-- (p_cliente, p_cnpj5) and returns the FIRST number in that block — the
-- caller computes gtin = 789 + cnpj5 + zeropad(start_seq + i, 4) + checkdigit
-- for i in [0, p_count). A single upsert under Postgres's row locking, not a
-- read-then-write from application code.
create or replace function gtin_reserve_sequence(p_cliente text, p_cnpj5 text, p_count int)
returns int as $$
declare
  new_last int;
begin
  insert into gtin_sequence (cliente, cnpj5, last_sequence)
  values (p_cliente, p_cnpj5, p_count)
  on conflict (cliente, cnpj5) do update
    set last_sequence = gtin_sequence.last_sequence + p_count,
        updated_at = now()
  returning last_sequence into new_last;
  return new_last - p_count + 1;
end;
$$ language plpgsql;

alter table gtin_sequence enable row level security;
alter table gtin_codes enable row level security;
