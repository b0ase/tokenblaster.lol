-- Scores: only the server (which checks the tx on chain) can mark a run verified.
-- The secret lives in tokenblaster_secrets (no RLS policies: not readable via the API) and in the
-- server env SCORES_SECRET. Insert it out of band:  insert into tokenblaster_secrets values ('scores', '<secret>');
create table if not exists public.tokenblaster_secrets (key text primary key, value text not null);
alter table public.tokenblaster_secrets enable row level security;
revoke all on public.tokenblaster_secrets from anon, authenticated;

drop function if exists public.tokenblaster_submit_score(text, text, text, bigint, numeric, jsonb, text, boolean, text);
create or replace function public.tokenblaster_submit_score(
  p_game text, p_mode text, p_name text, p_score bigint, p_secs numeric,
  p_meta jsonb default '{}'::jsonb, p_txid text default null, p_verified boolean default false, p_ip_hash text default null,
  p_secret text default null
) returns table (id bigint, ok boolean, error text)
language plpgsql security definer set search_path = public as $$
declare
  lim record;
  clean text;
  new_id bigint;
begin
  -- Only our server (holding the secret) may mark a run verified on chain.
  if p_verified and (p_secret is null or p_secret is distinct from (select value from public.tokenblaster_secrets where key = 'scores')) then
    p_verified := false;
  end if;
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
grant execute on function public.tokenblaster_submit_score(text, text, text, bigint, numeric, jsonb, text, boolean, text, text) to anon, authenticated;
