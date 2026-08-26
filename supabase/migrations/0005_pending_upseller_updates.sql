-- Canva -> UpSeller write-back queue. The backend (poll-canva-changes,
-- run on a schedule) detects a changed CANVA_MESTRE design, exports its
-- pages from Canva, and drops a row here. The Tampermonkey agent (which
-- holds the live UpSeller session cookie the backend doesn't have) polls
-- for pending rows for its own cliente, applies them to UpSeller, then
-- acks.

create table if not exists pending_upseller_updates (
  id uuid primary key default gen_random_uuid(),
  product_link_id uuid not null references product_links(id) on delete cascade,
  sku text not null,
  loja text not null,
  cliente text not null,
  image_urls jsonb not null, -- ordered array of Canva export PNG URLs (page order)
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pending_upseller_updates_status_idx
  on pending_upseller_updates (status, cliente, loja);

alter table pending_upseller_updates enable row level security;

-- Lets poll-canva-changes check designs in rotating batches (oldest
-- last_checked_at first) instead of hammering every CANVA_MESTRE design's
-- Canva API on every 3-min run — avoids blowing through Canva's rate
-- limits once the catalog is large.
alter table product_links add column if not exists last_checked_at timestamptz;
create index if not exists product_links_last_checked_at_idx on product_links (last_checked_at);
