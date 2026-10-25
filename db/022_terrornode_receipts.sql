-- $TERRORNODE receipts (src/lib/launch/receipts.ts, /api/terrornode/receipts).
-- One row per paid settlement tx (idempotent on its txid). Each row owns the receipt index range
-- [first_n, first_n + count - 1]; ranges are handed out under a row lock on the counter, so two sessions
-- can never get the same receipts. Writes through LAUNCH_SECRET-gated functions only, like 007/008.
-- Not applied automatically: run by hand.

create table if not exists public.tokenblaster_receipt_counter (
  token_id text primary key,
  issued   bigint not null default 0 check (issued >= 0 and issued <= 1000000000)
);
insert into public.tokenblaster_receipt_counter (token_id) values ('d5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1')
on conflict do nothing;

create table if not exists public.tokenblaster_receipts (
  session_txid  text primary key check (session_txid ~ '^[0-9a-f]{64}$'),
  token_id      text not null references public.tokenblaster_receipt_counter (token_id),
  recipient     text not null,
  handle        text not null default '',
  first_n       bigint not null check (first_n >= 1),
  count         bigint not null check (count > 0),
  paid_sats     bigint not null,
  owed_sats     bigint not null,
  penny_sats    bigint not null,
  status        text not null default 'reserved' check (status in ('reserved', 'sending', 'sent')),
  transfer_txid text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists tb_receipts_recipient_idx on public.tokenblaster_receipts (recipient, created_at desc);
create index if not exists tb_receipts_pending_idx on public.tokenblaster_receipts (created_at) where status <> 'sent';

alter table public.tokenblaster_receipt_counter enable row level security;
alter table public.tokenblaster_receipts enable row level security;
revoke all on public.tokenblaster_receipt_counter, public.tokenblaster_receipts from anon, authenticated;

-- Receipts issued so far (public: the cabinet prices the next shot from it).
create or replace function public.tokenblaster_receipts_issued(p_token text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select issued from public.tokenblaster_receipt_counter where token_id = p_token), 0);
$$;

-- Reserve the next `p_count` receipts for a settlement tx, atomically, and only if it paid enough:
--   owed = ceil(count + (penny - 1) * sum_{k=first-1}^{first+count-2} k / (N - 1)), N = 1e9 (same closed form as receipts.ts)
--   paid >= owed * (10000 - tol_bps) / 10000
-- Same txid again: returns the existing row unchanged (idempotent). Raises 'underpaid' / 'sold out'.
create or replace function public.tokenblaster_receipts_reserve(
  p_secret text, p_txid text, p_token text, p_recipient text, p_handle text, p_count bigint, p_paid bigint, p_penny bigint, p_tol_bps int)
returns setof public.tokenblaster_receipts
language plpgsql security definer set search_path = public as $$
declare
  c public.tokenblaster_receipt_counter;
  n1 numeric := 999999999;
  owed bigint;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.tokenblaster_receipts r where r.session_txid = p_txid) then
    return query select * from public.tokenblaster_receipts r where r.session_txid = p_txid;
    return;
  end if;
  if p_count <= 0 then raise exception 'no receipts'; end if;
  select * into c from public.tokenblaster_receipt_counter where token_id = p_token for update;
  if not found then raise exception 'unknown token'; end if;
  -- re-check under the lock (a concurrent call with the same txid waited on it)
  if exists (select 1 from public.tokenblaster_receipts r where r.session_txid = p_txid) then
    return query select * from public.tokenblaster_receipts r where r.session_txid = p_txid;
    return;
  end if;
  if c.issued + p_count > 1000000000 then raise exception 'sold out'; end if;
  owed := ceil((p_count::numeric * n1 * 2 + (p_penny - 1)::numeric * ((c.issued + c.issued + p_count - 1)::numeric * p_count)) / (n1 * 2))::bigint;
  if p_paid::numeric < owed::numeric * (10000 - p_tol_bps) / 10000 then raise exception 'underpaid: % < %', p_paid, owed; end if;
  update public.tokenblaster_receipt_counter set issued = issued + p_count where token_id = p_token;
  return query insert into public.tokenblaster_receipts (session_txid, token_id, recipient, handle, first_n, count, paid_sats, owed_sats, penny_sats)
    values (p_txid, p_token, p_recipient, left(coalesce(p_handle, ''), 64), c.issued + 1, p_count, p_paid, owed, p_penny)
    returning *;
end $$;

-- About to broadcast the pool transfer: remember its txid first, so a retry can tell whether it went out.
create or replace function public.tokenblaster_receipts_sending(p_secret text, p_txid text, p_transfer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_receipts set status = 'sending', transfer_txid = p_transfer where session_txid = p_txid and status <> 'sent';
end $$;

-- The transfer is on the network: move the pool to its new token coin, mark the row sent, release the lease.
create or replace function public.tokenblaster_receipts_sent(p_secret text, p_txid text, p_lease uuid, p_transfer text, p_token_utxo text, p_token_amt bigint, p_beef text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_coins
    set token_utxo = p_token_utxo, token_amt = p_token_amt, beef = p_beef, lease_id = null, lease_until = null, lease_quote = null
    where lease_id = p_lease;
  if not found then raise exception 'lease lost'; end if;
  update public.tokenblaster_receipts set status = 'sent', transfer_txid = p_transfer, sent_at = now() where session_txid = p_txid;
end $$;

-- Server read of one row (gated: includes nothing secret, but keeps the table closed).
create or replace function public.tokenblaster_receipts_get(p_secret text, p_txid text)
returns setof public.tokenblaster_receipts
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select * from public.tokenblaster_receipts r where r.session_txid = p_txid;
end $$;

grant execute on function public.tokenblaster_receipts_issued(text) to anon, authenticated;
