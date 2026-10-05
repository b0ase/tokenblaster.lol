-- Launchpad (/launch): BSV-21 memecoins on a bonding curve. The pools' keys are held by the server
-- (env LAUNCH_POOL_WIF); this database is the pool ledger. Writes only through the functions below,
-- which need the secret in tokenblaster_secrets key 'launch' (server env LAUNCH_SECRET):
--   insert into tokenblaster_secrets values ('launch', '<secret>');

create table if not exists public.tokenblaster_launch_coins (
  slot           uuid primary key default gen_random_uuid(),
  token_id       text unique,                         -- <launch txid>_1 once deployed
  sym            text not null check (sym ~ '^[A-Z0-9]{2,12}$'),
  name           text not null check (char_length(name) between 1 and 40),
  description    text not null default '' check (char_length(description) <= 400),
  image_type     text not null default 'image/webp',
  creator        text not null,                       -- creator's address (fees, "dev")
  creator_key    text not null,                       -- creator's identity public key (signature)
  route          jsonb not null default '{"kind":"creator"}'::jsonb,
  launch_msg     text not null,
  launch_sig     text not null,
  token_address  text not null,                       -- pool: holds the curve's tokens
  reserve_address text not null,                      -- pool: holds the curve's BSV
  vault_address  text not null,                       -- the 0.30% for non-creator routes
  fund_address   text,                                -- GorillaPool BSV-21 indexer fund
  fund_owed      bigint not null default 0,           -- index fees not yet paid (launch output etc.)
  status         text not null default 'pending' check (status in ('pending', 'live', 'failed')),
  sold           bigint not null default 0 check (sold >= 0),
  reserve_sats   bigint not null default 0 check (reserve_sats >= 0),
  token_utxo     text,                                -- txid_vout of the pool's token coin
  token_amt      bigint not null default 0,
  reserve_utxo   text,                                -- txid_vout of the pool's BSV coin (null before the first buy)
  beef           text,                                -- hex BEEF holding the pool coins' history
  route_accrued  bigint not null default 0,           -- sats of route fee sitting in the vault
  burned         bigint not null default 0,
  lease_id       uuid,
  lease_until    timestamptz,
  lease_quote    jsonb,
  ath_sold       bigint not null default 0,
  graduated_at   timestamptz,
  grad_rank      int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists tb_launch_coins_status_idx on public.tokenblaster_launch_coins (status, created_at desc);

create table if not exists public.tokenblaster_launch_trades (
  txid        text primary key check (txid ~ '^[0-9a-f]{64}$'),
  slot        uuid not null references public.tokenblaster_launch_coins (slot),
  side        text not null check (side in ('buy', 'sell', 'launch', 'burn')),
  trader      text not null,
  tokens      bigint not null,
  curve_sats  bigint not null,
  house_fee   bigint not null default 0,
  route_fee   bigint not null default 0,
  user_sats   bigint not null,
  sold_after  bigint not null,
  mm          boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists tb_launch_trades_slot_idx on public.tokenblaster_launch_trades (slot, created_at desc);
create index if not exists tb_launch_trades_trader_idx on public.tokenblaster_launch_trades (trader, created_at desc);
create index if not exists tb_launch_trades_time_idx on public.tokenblaster_launch_trades (created_at desc);

alter table public.tokenblaster_launch_coins enable row level security;
alter table public.tokenblaster_launch_trades enable row level security;
revoke all on public.tokenblaster_launch_coins, public.tokenblaster_launch_trades from anon, authenticated;

create or replace function public.tokenblaster_launch_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  -- coalesce: with no 'launch' secret set yet this must be false, never null (null would pass `if not ...`).
  select coalesce(p_secret is not null and p_secret = (select value from public.tokenblaster_secrets where key = 'launch'), false);
$$;

-- Generic secret-gated reader: the server reads full rows (including beef) through this.
create or replace function public.tokenblaster_launch_get(p_secret text, p_slot uuid default null, p_token text default null)
returns setof public.tokenblaster_launch_coins
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select * from public.tokenblaster_launch_coins c
    where (p_slot is not null and c.slot = p_slot) or (p_token is not null and c.token_id = p_token);
end $$;

-- Public board: everything but the pool's internals.
create or replace function public.tokenblaster_launch_board()
returns table (slot uuid, token_id text, sym text, name text, description text, creator text, route jsonb,
               sold bigint, reserve_sats bigint, burned bigint, route_accrued bigint, ath_sold bigint,
               graduated_at timestamptz, grad_rank int, created_at timestamptz,
               vol24 bigint, trades24 int, holders int, sold24 bigint)
language sql stable security definer set search_path = public as $$
  select c.slot, c.token_id, c.sym, c.name, c.description, c.creator, c.route, c.sold, c.reserve_sats, c.burned,
         c.route_accrued, c.ath_sold, c.graduated_at, c.grad_rank, c.created_at,
         coalesce((select sum(t.curve_sats) from public.tokenblaster_launch_trades t where t.slot = c.slot and not t.mm and t.created_at > now() - interval '24 hours'), 0)::bigint,
         coalesce((select count(*) from public.tokenblaster_launch_trades t where t.slot = c.slot and not t.mm and t.side in ('buy','sell') and t.created_at > now() - interval '24 hours'), 0)::int,
         coalesce((select count(*) from (select t.trader from public.tokenblaster_launch_trades t where t.slot = c.slot and t.side in ('buy','sell')
                    group by t.trader having sum(case when t.side = 'buy' then t.tokens else -t.tokens end) > 0) h), 0)::int,
         -- tokens sold 24h ago (for the 24h price change)
         coalesce((select t.sold_after from public.tokenblaster_launch_trades t where t.slot = c.slot and t.created_at <= now() - interval '24 hours' order by t.created_at desc limit 1), 0)::bigint
  from public.tokenblaster_launch_coins c where c.status = 'live'
  order by c.created_at desc limit 500;
$$;

create or replace function public.tokenblaster_launch_coin(p_token text)
returns table (slot uuid, token_id text, sym text, name text, description text, creator text, creator_key text, route jsonb,
               launch_msg text, launch_sig text, token_address text, reserve_address text, vault_address text, fund_address text,
               sold bigint, reserve_sats bigint, token_amt bigint, token_utxo text, reserve_utxo text, burned bigint,
               route_accrued bigint, ath_sold bigint, graduated_at timestamptz, grad_rank int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.slot, c.token_id, c.sym, c.name, c.description, c.creator, c.creator_key, c.route, c.launch_msg, c.launch_sig,
         c.token_address, c.reserve_address, c.vault_address, c.fund_address, c.sold, c.reserve_sats, c.token_amt,
         c.token_utxo, c.reserve_utxo, c.burned, c.route_accrued, c.ath_sold, c.graduated_at, c.grad_rank, c.created_at
  from public.tokenblaster_launch_coins c where c.token_id = p_token and c.status = 'live';
$$;

create or replace function public.tokenblaster_launch_trades_for(p_token text default null, p_trader text default null, p_limit int default 100)
returns table (txid text, token_id text, sym text, side text, trader text, tokens bigint, curve_sats bigint, user_sats bigint,
               sold_after bigint, mm boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.txid, c.token_id, c.sym, t.side, t.trader, t.tokens, t.curve_sats, t.user_sats, t.sold_after, t.mm, t.created_at
  from public.tokenblaster_launch_trades t join public.tokenblaster_launch_coins c on c.slot = t.slot
  where (p_token is null or c.token_id = p_token) and (p_trader is null or t.trader = p_trader)
  order by t.created_at desc limit least(greatest(p_limit, 1), 1000);
$$;

-- Server writes ---------------------------------------------------------------------------------

create or replace function public.tokenblaster_launch_create(p_secret text, p_row jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_launch_coins (slot, sym, name, description, image_type, creator, creator_key, route, launch_msg, launch_sig,
                                                token_address, reserve_address, vault_address)
  values ((p_row->>'slot')::uuid, p_row->>'sym', p_row->>'name', coalesce(p_row->>'description', ''), coalesce(p_row->>'image_type', 'image/webp'),
          p_row->>'creator', p_row->>'creator_key', coalesce(p_row->'route', '{"kind":"creator"}'::jsonb), p_row->>'launch_msg', p_row->>'launch_sig',
          p_row->>'token_address', p_row->>'reserve_address', p_row->>'vault_address')
  returning slot into s;
  return s;
end $$;

-- The launch tx was broadcast: the coin goes live with all its tokens in the pool.
create or replace function public.tokenblaster_launch_go_live(p_secret text, p_slot uuid, p_txid text, p_beef text, p_fund_owed bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_coins set status = 'live', token_id = p_txid || '_1', token_utxo = p_txid || '_1',
         token_amt = 1000000000, beef = p_beef, fund_owed = p_fund_owed, updated_at = now()
  where slot = p_slot and status = 'pending';
  if not found then raise exception 'no pending coin'; end if;
  insert into public.tokenblaster_launch_trades (txid, slot, side, trader, tokens, curve_sats, user_sats, sold_after)
  select p_txid, p_slot, 'launch', creator, 0, 0, 25000, 0 from public.tokenblaster_launch_coins where slot = p_slot
  on conflict do nothing;
end $$;

-- Take the pool for one trade (one at a time per coin). Returns the full row, or nothing if busy.
create or replace function public.tokenblaster_launch_lease(p_secret text, p_token text, p_lease uuid, p_secs int)
returns setof public.tokenblaster_launch_coins
language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query update public.tokenblaster_launch_coins c
    set lease_id = p_lease, lease_until = now() + make_interval(secs => p_secs), lease_quote = null
    where c.token_id = p_token and c.status = 'live' and (c.lease_until is null or c.lease_until < now())
    returning c.*;
end $$;

create or replace function public.tokenblaster_launch_set_quote(p_secret text, p_lease uuid, p_quote jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_coins set lease_quote = p_quote where lease_id = p_lease and lease_until > now();
  return found;
end $$;

create or replace function public.tokenblaster_launch_by_lease(p_secret text, p_lease uuid)
returns setof public.tokenblaster_launch_coins
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select * from public.tokenblaster_launch_coins c where c.lease_id = p_lease;
end $$;

create or replace function public.tokenblaster_launch_release(p_secret text, p_lease uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_coins set lease_id = null, lease_until = null, lease_quote = null where lease_id = p_lease;
end $$;

-- A trade was accepted by the network: move the pool to its new coins and record it.
create or replace function public.tokenblaster_launch_commit(p_secret text, p_lease uuid, p_t jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c public.tokenblaster_launch_coins;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  select * into c from public.tokenblaster_launch_coins where lease_id = p_lease for update;
  if not found then raise exception 'lease lost'; end if;
  update public.tokenblaster_launch_coins set
    sold = (p_t->>'sold_after')::bigint,
    reserve_sats = (p_t->>'reserve_sats')::bigint,
    token_utxo = p_t->>'token_utxo',
    token_amt = (p_t->>'token_amt')::bigint,
    reserve_utxo = p_t->>'reserve_utxo',
    beef = p_t->>'beef',
    fund_address = coalesce(p_t->>'fund_address', fund_address),
    fund_owed = coalesce((p_t->>'fund_owed')::bigint, fund_owed),
    route_accrued = route_accrued + coalesce((p_t->>'route_accrued')::bigint, 0),
    ath_sold = greatest(ath_sold, (p_t->>'sold_after')::bigint),
    graduated_at = case when graduated_at is null and (p_t->>'sold_after')::bigint >= 793100000 then now() else graduated_at end,
    grad_rank = case when graduated_at is null and (p_t->>'sold_after')::bigint >= 793100000
                     then (select count(*) + 1 from public.tokenblaster_launch_coins g where g.graduated_at is not null) else grad_rank end,
    lease_id = null, lease_until = null, lease_quote = null, updated_at = now()
  where slot = c.slot;
  insert into public.tokenblaster_launch_trades (txid, slot, side, trader, tokens, curve_sats, house_fee, route_fee, user_sats, sold_after, mm)
  values (p_t->>'txid', c.slot, p_t->>'side', p_t->>'trader', (p_t->>'tokens')::bigint, (p_t->>'curve_sats')::bigint,
          (p_t->>'house_fee')::bigint, (p_t->>'route_fee')::bigint, (p_t->>'user_sats')::bigint, (p_t->>'sold_after')::bigint,
          coalesce((p_t->>'mm')::boolean, false));
end $$;

grant execute on function public.tokenblaster_launch_board() to anon, authenticated;
grant execute on function public.tokenblaster_launch_coin(text) to anon, authenticated;
grant execute on function public.tokenblaster_launch_trades_for(text, text, int) to anon, authenticated;
