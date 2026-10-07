-- Hall of fame: "Most transactions put on chain" by player. NOT APPLIED: run on the Hetzner database when ready.
--
-- Why: tokenblaster_blasts (db/001) holds only txid + token + block time, because the OP_RETURN
-- "tokenblaster.lol" <token> <n> <game> carries no player. Scores carry a name but only the run's last txid. So nobody's
-- LIVE transaction count is recorded server-side. This adds the smallest thing that can: a per-run counter that
-- games report through the existing score route (or a sibling POST /api/txlog), never trusted beyond a cap.
--
-- Recording API (to build after applying; not part of this migration):
--   POST /api/txlog { game, player, txs, txid }  -> tokenblaster_record_txs(game, player, txs, txid, verified, ip_hash, SCORES_SECRET)
--   `player` is meta.x (an X @handle) when the game has one, else the score name; txid is the run's last tx, checked
--   with verifyRunTx(txid, tag) exactly like /api/scores. The page reads tokenblaster_top_tx_players() (below);
--   until this migration is applied that call fails and /leaderboard shows "Not tracked yet".

create table if not exists public.tokenblaster_tx_log (
  id         bigint generated always as identity primary key,
  game       text not null,
  player     text not null check (char_length(player) between 1 and 16 or player ~ '^@[A-Za-z0-9_]{1,15}$'),
  txs        integer not null check (txs between 1 and 100000),
  txid       text check (txid is null or txid ~ '^[0-9a-f]{64}$'),
  verified   boolean not null default false,
  ip_hash    text,
  created_at timestamptz not null default now()
);
-- One reported run per on-chain tx, so a run cannot be counted twice.
create unique index if not exists tokenblaster_tx_log_txid_idx on public.tokenblaster_tx_log (txid) where txid is not null;
create index if not exists tokenblaster_tx_log_player_idx on public.tokenblaster_tx_log (lower(player), created_at);
create index if not exists tokenblaster_tx_log_time_idx on public.tokenblaster_tx_log (created_at);
alter table public.tokenblaster_tx_log enable row level security;
-- No policies: only the functions below touch it.

-- Called by the API with the same SCORES_SECRET as tokenblaster_submit_score (without it nothing is verified).
create or replace function public.tokenblaster_record_txs(
  p_game text, p_player text, p_txs integer, p_txid text default null, p_verified boolean default false, p_ip_hash text default null, p_secret text default null
) returns table (ok boolean, error text)
language plpgsql security definer set search_path = public as $$
declare clean text;
begin
  -- Only our server (holding SCORES_SECRET, see db/003) may mark a count verified.
  if p_verified and (p_secret is null or p_secret is distinct from (select value from public.tokenblaster_secrets where key = 'scores')) then
    p_verified := false;
  end if;
  clean := left(btrim(regexp_replace(coalesce(p_player, ''), '[^A-Za-z0-9 _.@\-]', '', 'g')), 16);
  if clean = '' then return query select false, 'bad player'; return; end if;
  if p_txs is null or p_txs < 1 or p_txs > 100000 then return query select false, 'bad count'; return; end if;
  if p_txid is not null and (p_txid !~ '^[0-9a-f]{64}$' or exists (select 1 from public.tokenblaster_tx_log l where l.txid = p_txid)) then
    return query select false, 'bad or used txid'; return;
  end if;
  if p_ip_hash is not null and (select count(*) from public.tokenblaster_tx_log l where l.ip_hash = p_ip_hash and l.created_at > now() - interval '1 minute') >= 6 then
    return query select false, 'rate limited'; return;
  end if;
  insert into public.tokenblaster_tx_log (game, player, txs, txid, verified, ip_hash)
  values (p_game, clean, p_txs, p_txid, coalesce(p_verified, false) and p_txid is not null, p_ip_hash);
  return query select true, null::text;
end $$;

-- Only runs whose last tx was verified on chain count, so the board cannot be inflated by typing a number.
create or replace function public.tokenblaster_top_tx_players(since timestamptz default null, max_rows integer default 10)
returns table (player text, txs bigint, games bigint, last_txid text)
language sql stable security definer set search_path = public as $$
  select min(l.player), sum(l.txs)::bigint, count(distinct l.game)::bigint,
         (array_agg(l.txid order by l.created_at desc))[1]
  from public.tokenblaster_tx_log l
  where l.verified and (since is null or l.created_at >= since)
  group by lower(l.player)
  order by sum(l.txs) desc, lower(l.player)
  limit least(greatest(max_rows, 1), 50);
$$;

revoke all on function public.tokenblaster_record_txs(text, text, integer, text, boolean, text, text) from public;
revoke all on function public.tokenblaster_top_tx_players(timestamptz, integer) from public;
grant execute on function public.tokenblaster_record_txs(text, text, integer, text, boolean, text, text) to anon, authenticated;
grant execute on function public.tokenblaster_top_tx_players(timestamp with time zone, integer) to anon, authenticated;
