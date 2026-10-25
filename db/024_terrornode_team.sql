-- TERRORNODE TEAM MODE results (server/terrornode-team). FILE ONLY: apply on the Hetzner database when the game
-- server is wired to record results (v1 keeps matches in memory and records nothing). Shots are already on chain,
-- tagged "tokenblaster.lol" <ammo> <n> "terrornode-team" <match id> <team>, so the indexer can count them without this.
create table if not exists public.tokenblaster_team_matches (
  id            text primary key,              -- 'TN-<code>'
  code          text not null,
  tournament_id text,                          -- set by the bChatX room when the match is part of a tournament
  mode          text not null check (mode in ('coop', 'pvp')),
  winner        text check (winner in ('npg', 'erobotz', 'squad', 'horde', 'draw')),
  frags_npg     integer not null default 0,
  frags_erobotz integer not null default 0,
  waves         integer,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists tokenblaster_team_matches_tournament on public.tokenblaster_team_matches (tournament_id, ended_at desc);

create table if not exists public.tokenblaster_team_players (
  match_id     text not null references public.tokenblaster_team_matches (id) on delete cascade,
  player_id    text not null,
  name         text not null,
  identity_key text,
  team         text not null check (team in ('npg', 'erobotz')),
  score        integer not null default 0,
  kills        integer not null default 0,
  deaths       integer not null default 0,
  shots        integer not null default 0,
  tx_shots     integer not null default 0,
  stream_slot  text,
  primary key (match_id, player_id)
);

alter table public.tokenblaster_team_matches enable row level security;
alter table public.tokenblaster_team_players enable row level security;
-- read-only for the public (bChatX tournament boards); writes only from the game server's service role
create policy team_matches_read on public.tokenblaster_team_matches for select using (true);
create policy team_players_read on public.tokenblaster_team_players for select using (true);
