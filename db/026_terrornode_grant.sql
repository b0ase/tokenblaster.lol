-- $TERRORNODE grants (src/app/api/terrornode/grant): owner-approved transfers out of the receipt pool that are not
-- paid receipts (first one: the Twetch airdrop, 27 Oct 2026, 1,286,000 TERRORNODE to the airdrop wallet).
-- One row per purpose key and per transfer txid (both unique: the same grant can never go out twice).
-- The receipt counter is bumped by the amount, so `issued` keeps equal to the tokens out of the pool.
-- Writes through LAUNCH_SECRET-gated functions only, like 007/022. Not applied automatically: run by hand.

create table if not exists public.tokenblaster_grants (
  purpose     text primary key check (purpose ~ '^[a-z0-9-]{3,64}$'),
  txid        text not null unique check (txid ~ '^[0-9a-f]{64}$'),
  token_id    text not null references public.tokenblaster_receipt_counter (token_id),
  to_address  text not null,
  amount      bigint not null check (amount > 0),
  created_at  timestamptz not null default now()
);
alter table public.tokenblaster_grants enable row level security;
revoke all on public.tokenblaster_grants from anon, authenticated;

-- Server read: has this purpose already been granted?
create or replace function public.tokenblaster_grant_get(p_secret text, p_purpose text)
returns setof public.tokenblaster_grants
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select * from public.tokenblaster_grants g where g.purpose = p_purpose;
end $$;

-- The grant transfer is on the network: move the pool to its new token coin, release the lease, record the grant and
-- bump the receipt counter. Same purpose + txid again: no-op (idempotent). A different txid for a booked purpose raises.
create or replace function public.tokenblaster_receipts_grant(
  p_secret text, p_lease uuid, p_purpose text, p_transfer_txid text, p_token_utxo text, p_token_amt bigint, p_beef text,
  p_amount bigint, p_to text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.tokenblaster_grants;
  tok text;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  select * into g from public.tokenblaster_grants where purpose = p_purpose;
  if found then
    if g.txid = p_transfer_txid then return; end if;
    raise exception 'purpose already granted';
  end if;
  if p_amount <= 0 then raise exception 'bad amount'; end if;
  update public.tokenblaster_launch_coins
    set token_utxo = p_token_utxo, token_amt = p_token_amt, beef = p_beef, lease_id = null, lease_until = null, lease_quote = null
    where lease_id = p_lease
    returning token_id into tok;
  if not found then raise exception 'lease lost'; end if;
  update public.tokenblaster_receipt_counter set issued = issued + p_amount where token_id = tok;
  if not found then raise exception 'unknown token'; end if;
  insert into public.tokenblaster_grants (purpose, txid, token_id, to_address, amount) values (p_purpose, p_transfer_txid, tok, p_to, p_amount);
end $$;
