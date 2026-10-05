# TokenBlaster.lol

Live BSV traffic, chain games, and token-blasting competitions. Part of the b0ase portfolio;
competitions are meant to be joined from bWallet's chat rooms and Market.

- `/`: the live "highway": every car is a real transaction from a GorillaPool JungleBus subscription
  (`NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID`, Output types `pubkeyhash`), laned by type
- `/blast`: the gun app. Connect bWallet (BRC-100 `window.CWI`), pick a BSV-21 token (GorillaPool), load a
  pack (one approval funds an in-tab gun key), fire: each blast is broadcast to GorillaPool ARC and
  "landed" counts the ones seen back on the JungleBus feed. Unload returns leftover sats.
- `/arena`: DOOM-style Three.js arena; every shot is a real blast, sent to ARC in batches (`docs/arena.md`)
- `/launch`: BlastPad, launch BSV-21 memecoins on a bonding curve and trade them in one atomic tx each (`docs/launchpad.md`)
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

This is BSV: every action is a real transaction and the player pays its network fee. Some games also charge a small per-action amount (see each game).

## 1Sat Ordnance (weapons as 1Sat ordinals)

`/1satordnance` is the shop/promo page. Catalogue: `src/lib/ordnance.ts`. Ownership: `src/lib/useOrdnance.ts`
(wallet's `1sat`/`ordinals` baskets, plus GorillaPool `GET /api/txos/address/{addr}/unspent`, matched by origin or
collection + weapon). Owned guns unlock in Double-O Kweg (Q Branch on the menu) and the Arena gun picker.
Dev check without owning anything: `?ordnance=all` or `?ordnance=pnee-shotgun,safu-blaster` (dev builds, or
`NEXT_PUBLIC_TB_ADMIN=1`).

### Store (`/1satordnance/store`)

Buyers' wallets inscribe the gun to themselves and pay `priceOf(weapon)` (by rarity, `PRICE_SATS` in
`src/lib/ordnance.ts`) to `NEXT_PUBLIC_TB_HOUSE_ADDRESS` in one transaction. `/api/ordnance/issued` finds
them on GorillaPool (MAP app + weapon) and only counts origins whose tx paid the house; the games use the
same list. Weapons without hand-made art are rendered from their tinted model (`src/lib/ordnanceArt.ts`).
`/api/ordnance/manifest` is the public catalogue for wallets (see docs/handoff-bwalletx-3d-cabinet.md).

### Minting (owner, from your own wallet; no server key is involved)

1. Run the site with `NEXT_PUBLIC_TB_ADMIN=1` (or open `/1satordnance/mint?qbranch=1`). The page is not linked.
2. Connect your BRC-100 wallet (bWallet / Yours). Pick **Collection** and press inscribe; approve in the wallet.
   Copy the shown origin (`<txid>_0`) into `ORDNANCE_COLLECTION` in `src/lib/ordnance.ts`.
3. For each weapon: pick it, set the edition number, paste the collection origin, inscribe, approve in the wallet.
   Edition #1's origin goes into that weapon's `origin` field (the card flips from COMING SOON to MINTED).
   Later editions are recognised by collection + weapon name, no code change needed.
4. Blank "send to" keeps the ordinal in your wallet (derived key, `1sat` basket); or type an ordinals address.
5. Art is `public/ordnance/<id>.webp` (1024², ~30–60 KB each); MAP: app `tokenblaster.lol`, type `ord`,
   subType `collectionItem`, collection `1Sat Ordnance`, traits in `subTypeData`. Every inscription is a real
   mainnet transaction and pays its network fee. Commit + deploy after filling the origins.
