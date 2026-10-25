-- "Launched by <paymail>": the paymail of the key that signed (and funded) a coin's launch.
-- Looked up from creator_key at launch (src/lib/launch/launchedBy.ts); null = no paymail yet, retried by
-- scripts/launch-paymail-backfill.ts. Not applied automatically: run by hand, then run the backfill.
-- The app works before and after this runs (missing column → launched_by.paymail is null).

alter table public.tokenblaster_launch_coins add column if not exists launch_paymail text
  check (launch_paymail is null or (char_length(launch_paymail) <= 320 and launch_paymail ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
alter table public.tokenblaster_launch_coins add column if not exists launch_paymail_checked_at timestamptz;

create or replace function public.tokenblaster_launch_create(p_secret text, p_row jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_launch_coins (slot, sym, name, description, image_type, creator, creator_key, route, launch_msg, launch_sig,
                                                token_address, reserve_address, vault_address, launch_paymail, launch_paymail_checked_at)
  values ((p_row->>'slot')::uuid, p_row->>'sym', p_row->>'name', coalesce(p_row->>'description', ''), coalesce(p_row->>'image_type', 'image/webp'),
          p_row->>'creator', p_row->>'creator_key', coalesce(p_row->'route', '{"kind":"creator"}'::jsonb), p_row->>'launch_msg', p_row->>'launch_sig',
          p_row->>'token_address', p_row->>'reserve_address', p_row->>'vault_address', nullif(p_row->>'launch_paymail', ''), now())
  returning slot into s;
  return s;
end $$;

-- The return types change, so drop and recreate (same bodies as 007 plus creator_key / launch_paymail).
drop function if exists public.tokenblaster_launch_board();
create function public.tokenblaster_launch_board()
returns table (slot uuid, token_id text, sym text, name text, description text, creator text, route jsonb,
               sold bigint, reserve_sats bigint, burned bigint, route_accrued bigint, ath_sold bigint,
               graduated_at timestamptz, grad_rank int, created_at timestamptz,
               vol24 bigint, trades24 int, holders int, sold24 bigint, creator_key text, launch_paymail text)
language sql stable security definer set search_path = public as $$
  select c.slot, c.token_id, c.sym, c.name, c.description, c.creator, c.route, c.sold, c.reserve_sats, c.burned,
         c.route_accrued, c.ath_sold, c.graduated_at, c.grad_rank, c.created_at,
         coalesce((select sum(t.curve_sats) from public.tokenblaster_launch_trades t where t.slot = c.slot and not t.mm and t.created_at > now() - interval '24 hours'), 0)::bigint,
         coalesce((select count(*) from public.tokenblaster_launch_trades t where t.slot = c.slot and not t.mm and t.side in ('buy','sell') and t.created_at > now() - interval '24 hours'), 0)::int,
         coalesce((select count(*) from (select t.trader from public.tokenblaster_launch_trades t where t.slot = c.slot and t.side in ('buy','sell')
                    group by t.trader having sum(case when t.side = 'buy' then t.tokens else -t.tokens end) > 0) h), 0)::int,
         coalesce((select t.sold_after from public.tokenblaster_launch_trades t where t.slot = c.slot and t.created_at <= now() - interval '24 hours' order by t.created_at desc limit 1), 0)::bigint,
         c.creator_key, c.launch_paymail
  from public.tokenblaster_launch_coins c where c.status = 'live'
  order by c.created_at desc limit 500;
$$;

drop function if exists public.tokenblaster_launch_coin(text);
create function public.tokenblaster_launch_coin(p_token text)
returns table (slot uuid, token_id text, sym text, name text, description text, creator text, creator_key text, route jsonb,
               launch_msg text, launch_sig text, token_address text, reserve_address text, vault_address text, fund_address text,
               sold bigint, reserve_sats bigint, token_amt bigint, token_utxo text, reserve_utxo text, burned bigint,
               route_accrued bigint, ath_sold bigint, graduated_at timestamptz, grad_rank int, created_at timestamptz, launch_paymail text)
language sql stable security definer set search_path = public as $$
  select c.slot, c.token_id, c.sym, c.name, c.description, c.creator, c.creator_key, c.route, c.launch_msg, c.launch_sig,
         c.token_address, c.reserve_address, c.vault_address, c.fund_address, c.sold, c.reserve_sats, c.token_amt,
         c.token_utxo, c.reserve_utxo, c.burned, c.route_accrued, c.ath_sold, c.graduated_at, c.grad_rank, c.created_at, c.launch_paymail
  from public.tokenblaster_launch_coins c where c.token_id = p_token and c.status = 'live';
$$;

-- Backfill (scripts/launch-paymail-backfill.ts): coins with no paymail yet, and setting one.
create or replace function public.tokenblaster_launch_paymail_todo(p_secret text)
returns table (slot uuid, token_id text, sym text, creator_key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select c.slot, c.token_id, c.sym, c.creator_key from public.tokenblaster_launch_coins c
    where c.launch_paymail is null and c.status = 'live' order by c.created_at;
end $$;

-- Only fills an empty paymail (idempotent; never overwrites one already stored). p_paymail null = checked, none yet.
create or replace function public.tokenblaster_launch_set_paymail(p_secret text, p_slot uuid, p_paymail text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  update public.tokenblaster_launch_coins set launch_paymail = coalesce(launch_paymail, nullif(p_paymail, '')), launch_paymail_checked_at = now()
    where slot = p_slot;
  get diagnostics n = row_count;
  return n > 0;
end $$;

grant execute on function public.tokenblaster_launch_board() to anon, authenticated;
grant execute on function public.tokenblaster_launch_coin(text) to anon, authenticated;
revoke all on function public.tokenblaster_launch_paymail_todo(text) from public;
revoke all on function public.tokenblaster_launch_set_paymail(text, uuid, text) from public;
grant execute on function public.tokenblaster_launch_paymail_todo(text) to anon, authenticated;
grant execute on function public.tokenblaster_launch_set_paymail(text, uuid, text) to anon, authenticated;
