-- Public read path for GET /api/blasts/recent (bChatX /feed "Live" tab).
-- tokenblaster_blasts has RLS on and no anon select, so the API reads through this function only.
-- Returns chain data only (txid, token, n, game, times); no internal ids. Not yet applied: owner to approve.
create or replace function public.tokenblaster_recent(
  since timestamptz default null,
  before timestamptz default null,
  games text[] default null,
  max_rows integer default 50
)
returns table (txid text, token text, n integer, game text, seen_at timestamptz, block_height integer)
language sql stable security definer set search_path = public as $$
  select b.txid, b.token, b.n, b.game, b.seen_at, b.block_height
  from public.tokenblaster_blasts b
  where (since is null or b.seen_at > since)
    and (before is null or b.seen_at < before)
    and (games is null or b.game = any(games))
  order by b.seen_at desc, b.txid
  limit least(greatest(max_rows, 1), 200);
$$;
revoke all on function public.tokenblaster_recent(timestamptz, timestamptz, text[], integer) from public;
grant execute on function public.tokenblaster_recent(timestamptz, timestamptz, text[], integer) to anon, authenticated;

-- Newest-first scans by seen_at.
create index if not exists tokenblaster_blasts_seen_idx on public.tokenblaster_blasts (seen_at desc);
