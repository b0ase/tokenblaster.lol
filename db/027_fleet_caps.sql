-- Fleet-wide signing caps (28 Oct 2026 audit follow-up; VexVoid/SIGNING-PATHS-AUDIT.md, PR #155).
-- (1) tokenblaster_receipts_sent_24h: TERRORNODE sent by paid receipts in the last 24 h, read from the ledger so
--     RECEIPTS_DAILY_CAP_TOKENS holds across every Vercel instance (the in-process counter only bounds one).
--     Counts rows that are 'sending' (transfer signed, maybe broadcast) or 'sent', by sent_at, else created_at.
--     Grants (026) are owner-approved and not counted.
-- (2) tokenblaster_launch_unmark_claim: put the owed rows of a claim that never reached the chain back to unclaimed.
--     The DB cannot see the chain: the app MUST check the payout txid is unknown to the network (and its inputs
--     unspent by it) before calling this. Only rows for that address and txid are touched.
-- Both LAUNCH_SECRET-gated like 007/008/022 (server only: useless without the secret). Not applied automatically: run by hand.

create or replace function public.tokenblaster_receipts_sent_24h(p_secret text, p_token text)
returns bigint language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return coalesce((
    select sum(r.count) from public.tokenblaster_receipts r
    where r.token_id = p_token
      and r.status in ('sending', 'sent')
      and coalesce(r.sent_at, r.created_at) > now() - interval '24 hours'
  ), 0)::bigint;
end $$;

create or replace function public.tokenblaster_launch_unmark_claim(p_secret text, p_address text, p_txid text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  if p_txid is null or p_txid !~ '^[0-9a-f]{64}$' then raise exception 'bad txid'; end if;
  update public.tokenblaster_launch_owed set claim_txid = null where address = p_address and claim_txid = p_txid;
  get diagnostics n = row_count;
  return n;
end $$;

-- Grants: same as every other LAUNCH_SECRET-gated function (no explicit grant). The server calls PostgREST with the
-- anon key plus p_secret (src/lib/launch/server.ts rpc), so the secret check above is the gate; a service_role-only
-- grant would make these uncallable from the app.
