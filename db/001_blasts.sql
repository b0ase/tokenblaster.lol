-- TokenBlaster: every blast seen on chain (OP_FALSE OP_RETURN "tokenblaster.lol" <token> <n>).
-- Written by worker/indexer.ts on Hetzner; read by /api/leaderboard through tokenblaster_top().
create table if not exists public.tokenblaster_blasts (
  txid        text primary key,
  token       text not null,
  n           integer,
  block_height integer,
  block_time  timestamptz,
  seen_at     timestamptz not null default now()
);
create index if not exists tokenblaster_blasts_token_idx on public.tokenblaster_blasts (token);
create index if not exists tokenblaster_blasts_time_idx on public.tokenblaster_blasts ((coalesce(block_time, seen_at)));

-- Worker progress: last block fully processed.
create table if not exists public.tokenblaster_state (
  key   text primary key,
  value text not null
);

-- Chain data is public; the API only reads, and only through the function below.
alter table public.tokenblaster_blasts enable row level security;
alter table public.tokenblaster_state enable row level security;

create or replace function public.tokenblaster_top(since timestamptz default null, max_rows integer default 25)
returns table (token text, blasts bigint)
language sql stable security definer set search_path = public as $$
  select token, count(*) as blasts
  from public.tokenblaster_blasts
  where since is null or coalesce(block_time, seen_at) >= since
  group by token
  order by blasts desc, token
  limit least(max_rows, 100);
$$;
revoke all on function public.tokenblaster_top(timestamptz, integer) from public;
grant execute on function public.tokenblaster_top(timestamptz, integer) to anon, authenticated;
