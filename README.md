# TokenBlaster.lol

Live BSV traffic, chain games, and token-blasting competitions. Part of the b0ase portfolio;
competitions are meant to be joined from bWallet's chat rooms and Market.

- `/`: the live "highway": every car is a real transaction from a GorillaPool JungleBus subscription
  (`NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID`, Output types `pubkeyhash`), laned by type
- `/blast`: the gun app. Connect bWallet (BRC-100 `window.CWI`), pick a BSV-21 token (GorillaPool), load a
  pack (one approval funds an in-tab gun key), fire: each blast is broadcast to GorillaPool ARC and
  "landed" counts the ones seen back on the JungleBus feed. Unload returns leftover sats.
- `/arena`: DOOM-style Three.js arena; every shot is a real blast, sent to ARC in batches (`docs/arena.md`)
- `/api/leaderboard`: most-blasted tokens, from `worker/indexer.ts` (JungleBus → Postgres, `db/001_blasts.sql`)
- `/api/chain`: chain tip from GorillaPool JungleBus
- `blaster/blast.ts`: the command-line blaster (`pnpm blast`), dry run unless `--broadcast`

```bash
pnpm install
pnpm dev            # http://localhost:3000
BLASTER_WIF=<throwaway key> pnpm blast --token <your token id> --count 100
```

Environment (see `.env.example`): `NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID` for the highway (create a
free subscription at junglebus.gorillapool.io), `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the
leaderboard. Wallet connection and phone pairing follow `docs/wallet-connect.md`.

## Open source

MIT licensed (`LICENSE`). Contributions welcome. No keys live in this repo: the gun's key is made
in the player's browser, and the CLI blaster reads `BLASTER_WIF` from the environment only.

## Prior art

- bsv.lol (GorillaPool): live BSV visualiser and retro games. No public source found (2 Oct 2026).
- [Bitcoin-com/TXBlaster](https://github.com/Bitcoin-com/TXBlaster) (Stress Test 2018): MIT, but the repo only has a LICENSE.
- TeraGun: no public source found.

## Next

1. Referee: count accepted transactions tagged `tokenblaster <round> <player>` per round (JungleBus / ARC callbacks).
2. Rounds and live scoreboard, linked from a bWallet chat room.
3. Arcade games on live traffic.

No entry fees or prize pools: free entry, bragging rights (gambling rules and App Store).
