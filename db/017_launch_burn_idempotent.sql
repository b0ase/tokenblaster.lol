-- Buyback & burn: make the payout record idempotent for `burned`.
-- 008's tokenblaster_launch_payout added p_tokens to coins.burned even when the payout row already
-- existed (insert ... on conflict do nothing), so a retried booking double-counted the burn.
-- Now `burned` only moves when the payout row is new. Not applied automatically: run by hand.

create or replace function public.tokenblaster_launch_payout(p_secret text, p_txid text, p_slot uuid, p_kind text, p_sats bigint, p_tokens bigint, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_launch_payouts (txid, slot, kind, sats, tokens, detail) values (p_txid, p_slot, p_kind, p_sats, p_tokens, p_detail)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 and p_kind = 'buyback' then
    update public.tokenblaster_launch_coins set burned = burned + p_tokens where slot = p_slot;
  end if;
end $$;

-- Check before/after applying: coins whose `burned` disagrees with their buyback payouts.
--   select c.sym, c.burned, coalesce(sum(p.tokens), 0) as from_payouts
--   from tokenblaster_launch_coins c left join tokenblaster_launch_payouts p on p.slot = c.slot and p.kind = 'buyback'
--   group by c.slot, c.sym, c.burned having c.burned <> coalesce(sum(p.tokens), 0);
