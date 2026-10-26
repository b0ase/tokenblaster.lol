# TERRORNODE team mode

`/arcade/terrornode/team` (SOLO / TEAM tabs on `/arcade/terrornode`). Up to 16 players on the Shooting Gallery's
Neo-Tokyo street (the modern PBR city, not the Arena's pixel maze), rigged cast models in side colours.

| Match type | Sides | Ends |
|---|---|---|
| `coop` (PvE) | up to 16, all NPG squads; the server runs the Erobot horde | 10 waves cleared (`squad`) or 10:00 (`horde`) |
| `pvp` | NPG vs Erobotz, 8 a side, auto-balanced, side pick in the lobby, friendly fire off | first to 50 frags, or most frags at 10:00 (`draw` on a tie) |

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

## Spectators (livestream)

`/arcade/terrornode/watch?room=CODE`: read-only (`{t:'watch', match}` on the socket: no slot, no wallet), all
players, the wave / PvP clock and frags, tx/s, a slow broadcast camera. `&hud=only` = transparent overlay only (OBS
browser source over another scene), `&q=low` for a light machine. Up to 64 spectators a match. Falls back to polling
`/api/terrornode/team/CODE` if the socket can't connect.

## Load test (16 players)

    pnpm team:load -- --url https://team.tokenblaster.lol --n 16 --mode coop --level heart --secs 30
    # local: pnpm team:server, then pnpm team:load -- --n 16 --pid <server pid>

16 WebSocket bots + 2 spectators: tick rate on the wire, snapshot gaps, ping RTT, kB/s per player, and the
server's own tick rate / tick cost / CPU from `/health`. Exit 1 if fewer than N join, the tick drops under 18 Hz or
the reconnect loses its slot. `src/lib/teamSpectate.test.ts` runs it in CI against a local server.

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
