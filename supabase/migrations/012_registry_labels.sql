-- Named labels for registry stocks. Labels cannot be renamed (no UPDATE policy).
-- Deleting a label removes it from every stock via ON DELETE CASCADE.

create table if not exists public.registry_labels (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  constraint registry_labels_name_len check (char_length(trim(name)) between 1 and 40)
);

create unique index if not exists idx_registry_labels_user_name
  on public.registry_labels (user_id, lower(trim(name)));

create index if not exists idx_registry_labels_user
  on public.registry_labels (user_id, created_at);

create table if not exists public.registry_stock_labels (
  user_id text not null,
  symbol text not null,
  label_id uuid not null references public.registry_labels (id) on delete cascade,
  primary key (user_id, symbol, label_id)
);

create index if not exists idx_registry_stock_labels_symbol
  on public.registry_stock_labels (user_id, symbol);

create index if not exists idx_registry_stock_labels_label
  on public.registry_stock_labels (user_id, label_id);

alter table public.registry_stock_labels
  drop constraint if exists registry_stock_labels_stock_fk;

alter table public.registry_stock_labels
  add constraint registry_stock_labels_stock_fk
  foreign key (user_id, symbol)
  references public.registry_stocks (user_id, symbol)
  on delete cascade;

alter table public.registry_labels enable row level security;
alter table public.registry_stock_labels enable row level security;

drop policy if exists registry_labels_select on public.registry_labels;
create policy registry_labels_select on public.registry_labels for select
  using (public.is_allowed_user() and user_id = public.firebase_user_id());

drop policy if exists registry_labels_insert on public.registry_labels;
create policy registry_labels_insert on public.registry_labels for insert
  with check (public.is_allowed_user() and user_id = public.firebase_user_id());

drop policy if exists registry_labels_delete on public.registry_labels;
create policy registry_labels_delete on public.registry_labels for delete
  using (public.is_allowed_user() and user_id = public.firebase_user_id());

drop policy if exists registry_stock_labels_select on public.registry_stock_labels;
create policy registry_stock_labels_select on public.registry_stock_labels for select
  using (public.is_allowed_user() and user_id = public.firebase_user_id());

drop policy if exists registry_stock_labels_insert on public.registry_stock_labels;
create policy registry_stock_labels_insert on public.registry_stock_labels for insert
  with check (public.is_allowed_user() and user_id = public.firebase_user_id());

drop policy if exists registry_stock_labels_delete on public.registry_stock_labels;
create policy registry_stock_labels_delete on public.registry_stock_labels for delete
  using (public.is_allowed_user() and user_id = public.firebase_user_id());
