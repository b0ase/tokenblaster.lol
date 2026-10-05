-- TokenBlaster arcade high scores. Written only through tokenblaster_submit_score() (called by
-- POST /api/scores, which checks LIVE runs on chain first), read through tokenblaster_top_scores().
create table if not exists public.tokenblaster_scores (
  id         bigint generated always as identity primary key,
  game       text not null,
  mode       text not null check (mode in ('practice', 'live')),
  name       text not null check (char_length(name) between 1 and 16),
  score      bigint not null check (score >= 0),
  secs       numeric(10, 1) not null default 0 check (secs >= 0),
  meta       jsonb not null default '{}'::jsonb,
  txid       text check (txid is null or txid ~ '^[0-9a-f]{64}$'),
  verified   boolean not null default false,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists tokenblaster_scores_game_score_idx on public.tokenblaster_scores (game, score desc, created_at);
create index if not exists tokenblaster_scores_game_secs_idx on public.tokenblaster_scores (game, secs, created_at);
create index if not exists tokenblaster_scores_time_idx on public.tokenblaster_scores (created_at);
create index if not exists tokenblaster_scores_ip_idx on public.tokenblaster_scores (ip_hash, created_at);
create index if not exists tokenblaster_scores_name_idx on public.tokenblaster_scores (lower(name), created_at);
-- One on-chain tx proves one run.
create unique index if not exists tokenblaster_scores_txid_idx on public.tokenblaster_scores (txid) where txid is not null;

alter table public.tokenblaster_scores enable row level security;
-- No policies: anon/authenticated can't touch the table directly, only via the functions below.

-- Plausibility per game: max points per second of play (+ a small head start), min/max run length.
create or replace function public.tokenblaster_score_limit(g text)
returns table (per_sec numeric, base numeric, min_secs numeric)
language sql immutable as $$
  select t.per_sec, t.base, t.min_secs from (values
    ('hopper',           400::numeric, 2000::numeric, 1::numeric),
    ('invaders',         300, 2000, 1),
    ('snake',            150, 500, 1),
    ('kweg',             400, 2000, 1),
    ('frogger',          0.5, 3, 2),
    ('doubleo-facility', 3, 10, 10),
    ('doubleo-tower',    3, 10, 10),
    ('doubleo-vault',    3, 10, 10)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;

create or replace function public.tokenblaster_submit_score(
  p_game text, p_mode text, p_name text, p_score bigint, p_secs numeric,
  p_meta jsonb default '{}'::jsonb, p_txid text default null, p_verified boolean default false, p_ip_hash text default null
) returns table (id bigint, ok boolean, error text)
language plpgsql security definer set search_path = public as $$
declare
  lim record;
  clean text;
  new_id bigint;
begin
  select * into lim from public.tokenblaster_score_limit(p_game);
  if not found then return query select null::bigint, false, 'unknown game'; return; end if;
  if p_mode not in ('practice', 'live') then return query select null::bigint, false, 'bad mode'; return; end if;
  clean := left(btrim(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 _.\-]', '', 'g')), 16);
  if clean = '' then return query select null::bigint, false, 'bad name'; return; end if;
  if p_score is null or p_score < 0 or p_secs is null or p_secs < lim.min_secs or p_secs > 6 * 3600 then
    return query select null::bigint, false, 'implausible run'; return;
  end if;
  if p_score > lim.base + lim.per_sec * p_secs then return query select null::bigint, false, 'implausible score'; return; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' or length(p_meta::text) > 500 then
    return query select null::bigint, false, 'bad meta'; return;
  end if;
  if p_txid is not null and p_txid !~ '^[0-9a-f]{64}$' then return query select null::bigint, false, 'bad txid'; return; end if;
  -- Rate limit: 6 a minute / 60 an hour per IP hash, 6 a minute per name.
  if p_ip_hash is not null and (
       (select count(*) from public.tokenblaster_scores s where s.ip_hash = p_ip_hash and s.created_at > now() - interval '1 minute') >= 6
    or (select count(*) from public.tokenblaster_scores s where s.ip_hash = p_ip_hash and s.created_at > now() - interval '1 hour') >= 60) then
    return query select null::bigint, false, 'rate limited'; return;
  end if;
  if (select count(*) from public.tokenblaster_scores s where lower(s.name) = lower(clean) and s.created_at > now() - interval '1 minute') >= 6 then
    return query select null::bigint, false, 'rate limited'; return;
  end if;
  if p_txid is not null and exists (select 1 from public.tokenblaster_scores s where s.txid = p_txid) then
    return query select null::bigint, false, 'tx already used'; return;
  end if;
  insert into public.tokenblaster_scores (game, mode, name, score, secs, meta, txid, verified, ip_hash)
  values (p_game, p_mode, clean, p_score, round(p_secs, 1), p_meta, p_txid, p_mode = 'live' and p_txid is not null and coalesce(p_verified, false), p_ip_hash)
  returning tokenblaster_scores.id into new_id;
  return query select new_id, true, null::text;
end $$;

create or replace function public.tokenblaster_top_scores(p_game text, since timestamptz default null, max_rows integer default 10, sort text default 'score')
returns table (id bigint, name text, score bigint, secs numeric, mode text, verified boolean, txid text, meta jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.score, s.secs, s.mode, s.verified, s.txid, s.meta, s.created_at
  from public.tokenblaster_scores s
  where s.game = p_game and (since is null or s.created_at >= since)
  order by
    case when sort = 'time' then s.secs end asc,
    s.score desc, s.secs asc, s.created_at asc
  limit least(greatest(max_rows, 1), 50);
$$;

revoke all on function public.tokenblaster_submit_score(text, text, text, bigint, numeric, jsonb, text, boolean, text) from public;
revoke all on function public.tokenblaster_top_scores(text, timestamptz, integer, text) from public;
revoke all on function public.tokenblaster_score_limit(text) from public;
grant execute on function public.tokenblaster_submit_score(text, text, text, bigint, numeric, jsonb, text, boolean, text) to anon, authenticated;
grant execute on function public.tokenblaster_top_scores(text, timestamptz, integer, text) to anon, authenticated;
