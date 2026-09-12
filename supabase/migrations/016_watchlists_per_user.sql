-- Auto P&L watchlists used a global primary key (tier slug such as loss-upto-5k).
-- A second user's upload upserted those same ids, collided with the first user's
-- rows, and Postgres rejected the write as an RLS policy violation.
-- Scope the primary key per account so each user has their own watchlists.

alter table public.watchlists drop constraint if exists watchlists_pkey;
alter table public.watchlists add primary key (user_id, id);
