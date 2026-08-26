-- Foundation for the unified multi-computer agent platform: every company
-- computer runs one thin Tampermonkey "bridge" script, registers itself
-- once (device_id, generated client-side, persisted via GM_setValue — NOT
-- tied to UpSeller login, since UpSeller accounts/puids can be shared or
-- differ per employee while a physical computer stays the same), and is
-- assigned a "papel" (role) by an admin, which determines which modules
-- (checkout, compras.pedidos, compras.etiquetas, canva_sync, ...) light
-- up on that computer. A generalized action queue (fila_de_acoes) lets
-- the future admin panel (and other modules) ask any suitable agent to
-- perform an UpSeller-side action (create a kit, edit a product, print a
-- label, ...) without the backend ever needing UpSeller session cookies
-- itself — same pattern already proven by pending_upseller_updates in the
-- Canva sync, generalized beyond just photo updates.

create table if not exists papeis (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null, -- "Expedição", "Agência", "Admin"
  modulos jsonb not null default '[]'::jsonb, -- e.g. ["checkout", "compras.pedidos", "compras.etiquetas", "canva_sync"]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,
  nome text, -- friendly label set by the admin, e.g. "Expedição 01"
  papel_id uuid references papeis(id) on delete set null,
  upseller_puid text, -- last-seen UpSeller account id, informational only
  last_checkin_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists fila_de_acoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null, -- 'criar_kit' | 'editar_produto' | 'imprimir_etiqueta' | ...
  payload jsonb not null,
  alvo_papel_id uuid references papeis(id), -- null = any agent can pick it up
  alvo_agent_id uuid references agents(id), -- null = any matching agent can pick it up
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists fila_de_acoes_status_idx on fila_de_acoes (status, alvo_papel_id, alvo_agent_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists papeis_set_updated_at on papeis;
create trigger papeis_set_updated_at
  before update on papeis
  for each row execute function set_updated_at();

-- Same posture as every other table in this project: only ever touched by
-- Edge Functions (service_role) or the admin panel's server-side code
-- (also service_role, never exposed to the browser) — never directly by
-- the Tampermonkey agent or any browser client.
alter table papeis enable row level security;
alter table agents enable row level security;
alter table fila_de_acoes enable row level security;

-- Seed the three roles described by the user.
insert into papeis (nome, modulos) values
  ('Admin', '["checkout", "compras.pedidos", "compras.etiquetas", "compras.analise", "canva_sync"]'::jsonb),
  ('Expedição', '["checkout", "compras.pedidos", "compras.etiquetas", "canva_sync"]'::jsonb),
  ('Agência', '["compras.pedidos", "compras.etiquetas", "compras.analise", "canva_sync"]'::jsonb)
on conflict (nome) do nothing;
