-- Maps each agency client to their dedicated Canva folder (created once,
-- reused for every subsequent design). "Agencia - <CLIENTE>" folders,
-- created directly under the account's root Projects.

create table if not exists canva_client_folders (
  cliente text primary key,
  folder_id text not null,
  created_at timestamptz not null default now()
);

alter table canva_client_folders enable row level security;
