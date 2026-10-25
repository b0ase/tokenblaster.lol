-- Recoverable gun (25 Oct 2026): the browser gun's key, ENCRYPTED BY THE PLAYER'S OWN BRC-100 WALLET
-- (protocol [1,'tokenblaster gun'], keyID 'v1', counterparty 'self'), stored with the gun's address under the
-- player's identity key. The server never sees the key itself. Written and read only through the app's
-- signed /api/gun/backup route (src/lib/gunBackup.ts), which calls these secret-gated functions.
-- Not applied automatically: run by hand. The app works before this runs (backups just fail quietly).

create table if not exists public.tokenblaster_gun_backups (
  identity_key text not null check (identity_key ~ '^0[23][0-9a-f]{64}$'),
  address      text not null check (address ~ '^1[1-9A-HJ-NP-Za-km-z]{25,34}$'),
  ciphertext   text not null check (char_length(ciphertext) between 32 and 1024 and ciphertext ~ '^[0-9a-f]+$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (identity_key, address)
);
alter table public.tokenblaster_gun_backups enable row level security;
-- No policies: only the security-definer functions below touch it.

-- First backup for (identity, address) wins: a later request can never replace a good ciphertext.
create or replace function public.tokenblaster_gun_backup_put(p_secret text, p_identity_key text, p_address text, p_ciphertext text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  insert into public.tokenblaster_gun_backups (identity_key, address, ciphertext)
  values (p_identity_key, p_address, p_ciphertext)
  on conflict (identity_key, address) do update set updated_at = now();
end $$;

create or replace function public.tokenblaster_gun_backup_list(p_secret text, p_identity_key text)
returns table (address text, ciphertext text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tokenblaster_launch_ok(p_secret) then raise exception 'forbidden'; end if;
  return query select b.address, b.ciphertext, b.created_at from public.tokenblaster_gun_backups b
    where b.identity_key = p_identity_key order by b.updated_at desc limit 20;
end $$;

revoke all on function public.tokenblaster_gun_backup_put(text, text, text, text) from public;
revoke all on function public.tokenblaster_gun_backup_list(text, text) from public;
grant execute on function public.tokenblaster_gun_backup_put(text, text, text, text) to anon, authenticated;
grant execute on function public.tokenblaster_gun_backup_list(text, text) to anon, authenticated;
