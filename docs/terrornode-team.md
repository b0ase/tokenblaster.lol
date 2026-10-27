# TERRORNODE team mode

`/arcade/terrornode/team` (SOLO / TEAM tabs on `/arcade/terrornode`). Up to 64 players (co-op) or 32 v 32 (PvP) on
the Shooting Gallery's Neo-Tokyo street or the TERRORNODE MELEE plaza, rigged cast models in side colours.

| Match type | Sides | Ends |
|---|---|---|
| `coop` (PvE) | up to 64, all NPG squads; the server runs the Erobot horde, sized to the crowd | the level's waves cleared (`squad`) or 10:00 (`horde`) |
| `pvp` | NPG vs Erobotz, 32 a side, auto-balanced, side pick in the lobby, friendly fire off | first to 50 frags, or most frags at 10:00 (`draw` on a tie) |

Logic: `src/lib/teammode/match.ts` (pure, tested in `src/lib/teammode.test.ts`). Server: `server/terrornode-team/server.ts`
(Node + `ws`, 20 Hz authoritative tick, clamped movement, server-side hit rays, 60 s reconnect grace with a resume
token). Client: `src/lib/teammode/{client,scene}.ts`, `src/components/terrornode/TeamMode.tsx`.

## Money

Same cabinet as solo (`useCabinet` + `CoinCabinet`): 1c–$1 coins tally, LOCK & LOAD is ONE wallet request that funds
the player's own browser gun. Each trigger pull is sent to the server for the hit and queued as a real BSV transaction,
batched to ARC every 400 ms (`Gun.fireBatch`), tagged

    OP_FALSE OP_RETURN "tokenblaster.lol" <ammo> <n> "terrornode-team" <match id TN-CODE> <npg|erobotz>

The browser reports how many ARC accepted (`{t:'tx', n}`), shown as `txShots` per player. `?dryrun=1` / free play
skip the wallet entirely.

## For the bChatX TERRORNODE room (bit-sign)

- Make a match: `POST https://tokenblaster.lol/api/terrornode/team` `{ mode: 'coop'|'pvp', tournamentId? }` →
  `{ code, id, inviteUrl }` (`inviteUrl` = `/arcade/terrornode/team?match=CODE`).
- Poll state: `GET /api/terrornode/team/CODE` → `{ id, code, tournamentId, mode, phase, teams:[{id:'npg'|'erobotz',
  name, size, max, frags, score, players}], players:[{id, name, identityKey, team, score, kills, deaths, txShots,
  alive, connected, streamSlot}], streams:[{player, team, slot}], wave, endsAt, winner }`. CORS open, no secrets.
- List a tournament: `GET /api/terrornode/team?tournament=<id>`.
- GO LIVE: the existing button (#82/#83) streams the canvas to the room; on start/stop it fires `tb:golive`
  `{handle}` and team mode sends it to the server, so `streamSlot` = the player's bChatX LiveKit handle.

## Levels (26 Oct)

Every match is made on a level (`POST /api/terrornode/team {mode, level}`; `level` = `assault` (default, the
original 10 waves) | `market` | `rails` | `datacore` | `heart`). Co-op waves, enemy kinds and speed come from
`src/lib/teammode/levels.ts`; the Heart's last wave brings a boss (one huge Erobot, 4000 HP). The street takes the
level's palette and its dressing (`src/lib/terrornode/dressing.ts`, lazy-loaded). Solo levels: `src/lib/terrornode/levels.ts`.

## MELEE: the 64-player arena (26 Oct, for the 1 Nov launch)

`level: 'melee'` (TERRORNODE MELEE) is fought on the TERRORNODE PLAZA (`src/lib/teammode/arena.ts`, drawn by
`src/lib/teammode/meleeScene.ts`): a round plaza 156 m across round the tower, three terraces on ramps, pillars,
crates and barriers that stop bodies and rounds on the server, 32 spawn points round the rim (PvP: NPG south, Erobotz
north), 8 horde gates plus the 4 tower doors. The last wave brings the TERRORNODE TOWER CORE out of the tower door.
From the solo level select it plays as a one-player co-op match (`/arcade/terrornode/team?level=melee&solo=1`).

Crowd scaling (`src/lib/teammode/levels.ts`): 1-4 players play the level as written; past that each wave is
`× (players/4)^0.85` (64 players ≈ 10.6×), the live cap is `40 + 2 × (players − 4)` up to 160, and the boss HP is
`× players^0.85`.

Interest management (`match.ts` `snapParts` / `snapFor`, `INTEREST`): past 16 players each socket gets the players
within 48 m (at most 24, nearest first), the Erobots within 48 m (at most 48), the boss always, at most 20 shot
events, and the room counters `c: {pc, al, ec, tps, boss}`. Entities are serialised once a tick and joined per socket.
Spectators get the whole match. Full state goes at 1 Hz past 16 players; joins and drops are coalesced into it.

ROOM TX/SEC: the server sums every player's paid rounds (shots with a txid and the browser's `{t:'tx', n}` ARC
reports) over 5 s: `c.tps` in every snapshot, `txPerSec` in the public state, the server total in `/health`. Shown
big on the spectator view and in the in-game HUD. Bots and free play send no transactions, so it reads 0 there.

## Spectators (livestream)

`/arcade/terrornode/watch?room=CODE`: read-only (`{t:'watch', match}` on the socket: no slot, no wallet), the ROOM
TX/SEC headline, a TOP 10 board, a compact roster that fits 64, the boss bar, the wave / PvP clock and frags, a slow
broadcast camera (on the plaza: an orbit over the rim). `&hud=only` = transparent overlay only (OBS
browser source over another scene), `&q=low` for a light machine. Up to 64 spectators a match. Falls back to polling
`/api/terrornode/team/CODE` if the socket can't connect.

## Load test

    pnpm team:load -- --url https://team.tokenblaster.lol --n 16 --mode coop --level heart --secs 30
    pnpm team:load -- --url https://team.tokenblaster.lol --n 64 --level melee --secs 30
    pnpm team:load -- --n 64 --level melee --matches 4 --secs 30     # 4 x 64 at once (the ceiling)
    # local: pnpm team:server, then pnpm team:load -- --n 16 --pid <server pid>

16 WebSocket bots + 2 spectators: tick rate on the wire, snapshot gaps, ping RTT, kB/s per player, and the
server's own tick rate / tick cost / CPU from `/health`. Exit 1 if fewer than N join, the tick drops under 18 Hz or
the reconnect loses its slot. `src/lib/teamSpectate.test.ts` runs it in CI against a local server.

## Text chat (27 Oct)

In-match chat over the same websocket: `{t:'chat', ch:'team'|'all'|'dm', to?, text}`. Team = your own side only,
All = everyone in the match (opponents and spectators), dm = one player. The server routes (team messages are never
written to the other side's sockets), relays and stores nothing (gone when the match ends), strips control chars,
caps at 280 chars and limits 5 messages / 5 s per player. Spectators read All, can't send. The server advertises
`features: ['chat']` in `/health` and the welcome / watching reply; the site shows the chat panel only then, so it is
hidden against older servers. Enter opens chat (leaves pointer lock), Enter sends, Esc blurs; click a name to mute it
locally. Code: `src/lib/teammode/chat.ts`, `src/components/terrornode/TeamChat.tsx`, tests `src/lib/teamChat.test.ts`.

## Run locally

    pnpm team:server                       # :8787
    pnpm team:bots --n 16 --mode pvp       # 16 headless bots, reconnect check, prints the match state
    pnpm dev                               # then /arcade/terrornode/team?dryrun=1

## Deploy (owner)

1. Hetzner: `pnpm team:build` → `server/terrornode-team/dist/server.mjs`; rsync it plus `ecosystem.config.cjs`;
   `pm2 start server/terrornode-team/ecosystem.config.cjs && pm2 save` (one process; matches live in memory).
2. TLS websocket: proxy `wss://team.tokenblaster.lol` → `127.0.0.1:8787` (nginx/Caddy with Upgrade headers).
3. Vercel env: `NEXT_PUBLIC_TERRORNODE_TEAM_WS=wss://team.tokenblaster.lol/ws`, `TERRORNODE_TEAM_URL=https://team.tokenblaster.lol`.
   Server env: `PORT`, `PUBLIC_SITE`, `ALLOW_ORIGINS` (see ecosystem file).
4. Optional: `db/024_terrornode_team.sql` (results tables) — not used by v1, which records nothing in the DB.

## Later

Write results to `db/024`; per-hit token transfers (Arena "live ammo"); NPG/Erobotz side skins beyond the gallery cast;
server-side check of the shot txids against ARC before they count.
