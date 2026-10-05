-- Launchpad fee vaults: what each coin's vault owes holders (claimable), and every payout it made.
-- Writes through secret-gated functions only (tokenblaster_secrets 'launch'), like 007.

create table if not exists public.tokenblaster_launch_owed (
  id         bigint generated always as identity primary key,
  slot       uuid not null references public.tokenblaster_launch_coins (slot),
  address    text not null,                 -- the holder's wallet (identity) address
  sats       bigint not null check (sats > 0),
  claim_txid text,                          -- set when paid out
  created_at timestamptz not null default now()
);
create index if not exists tb_launch_owed_addr_idx on public.tokenblaster_launch_owed (address) where claim_txid is null;
create index if not exists tb_launch_owed_slot_idx on public.tokenblaster_launch_owed (slot) where claim_txid is null;

create table if not exists public.tokenblaster_launch_payouts (
  txid       text not null,
  slot       uuid not null references public.tokenblaster_launch_coins (slot),
  kind       text not null check (kind in ('split', 'holders', 'claim', 'buyback')),
  sats       bigint not null,
  tokens     bigint not null default 0,     -- buyback: tokens burned
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (txid, slot, kind)
);
create index if not exists tb_launch_payouts_slot_idx on public.tokenblaster_launch_payouts (slot, created_at desc);

alter table public.tokenblaster_launch_owed enable row level security;
alter table public.tokenblaster_launch_payouts enable row level security;
revoke all on public.tokenblaster_launch_owed, public.tokenblaster_launch_payouts from anon, authenticated;

-- Coins whose 0.30% goes to the vault, with what the vault still owes holders.
create or replace function public.tokenblaster_launch_vault_coins(p_secret text)
returns table (slot uuid, token_id text, sym text, route jsonb, vault_address text, owed bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select c.slot, c.token_id, c.sym, c.route, c.vault_address,
    coalesce((select sum(o.sats) from public.tokenblaster_launch_owed o where o.slot = c.slot and o.claim_txid is null), 0)::bigint
  from public.tokenblaster_launch_coins c where c.status = 'live' and c.route->>'kind' <> 'creator';
end $$;

create or replace function public.tokenblaster_launch_owe(p_secret text, p_slot uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_launch_owed (slot, address, sats)
  select p_slot, r->>'address', (r->>'sats')::bigint from jsonb_array_elements(p_rows) r where (r->>'sats')::bigint > 0;
end $$;

create or replace function public.tokenblaster_launch_payout(p_secret text, p_txid text, p_slot uuid, p_kind text, p_sats bigint, p_tokens bigint, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_launch_payouts (txid, slot, kind, sats, tokens, detail) values (p_txid, p_slot, p_kind, p_sats, p_tokens, p_detail)
  on conflict do nothing;
  if p_kind = 'buyback' then
    update public.tokenblaster_launch_coins set burned = burned + p_tokens where slot = p_slot;
  end if;
end $$;

-- Owed to one wallet, per coin, not yet claimed.
create or replace function public.tokenblaster_launch_owed_to(p_address text)
returns table (slot uuid, token_id text, sym text, vault_address text, sats bigint)
language sql stable security definer set search_path = public as $$
  select c.slot, c.token_id, c.sym, c.vault_address, sum(o.sats)::bigint
  from public.tokenblaster_launch_owed o join public.tokenblaster_launch_coins c on c.slot = o.slot
  where o.address = p_address and o.claim_txid is null group by c.slot, c.token_id, c.sym, c.vault_address;
$$;

-- Claim: mark everything owed to the address as paid by p_txid (only after the payout was broadcast).
create or replace function public.tokenblaster_launch_mark_claimed(p_secret text, p_address text, p_ids bigint[], p_txid text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_owed set claim_txid = p_txid where address = p_address and id = any(p_ids) and claim_txid is null;
end $$;

create or replace function public.tokenblaster_launch_owed_rows(p_secret text, p_address text)
returns table (id bigint, slot uuid, sats bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select o.id, o.slot, o.sats from public.tokenblaster_launch_owed o where o.address = p_address and o.claim_txid is null;
end $$;

-- Public record of payouts (rewards page, coin page).
create or replace function public.tokenblaster_launch_payouts_for(p_token text default null, p_limit int default 100)
returns table (txid text, token_id text, sym text, kind text, sats bigint, tokens bigint, detail jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.txid, c.token_id, c.sym, p.kind, p.sats, p.tokens, p.detail, p.created_at
  from public.tokenblaster_launch_payouts p join public.tokenblaster_launch_coins c on c.slot = p.slot
  where p_token is null or c.token_id = p_token
  order by p.created_at desc limit least(greatest(p_limit, 1), 500);
$$;

grant execute on function public.tokenblaster_launch_owed_to(text) to anon, authenticated;
grant execute on function public.tokenblaster_launch_payouts_for(text, int) to anon, authenticated;
